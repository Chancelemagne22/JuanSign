import os
import torch
import numpy as np
import matplotlib.pyplot as plt
import cv2
from PIL import Image

from resnet_lstm_architecture import ResNetLSTM


# Architecture / preprocessing constants — must match resnet_lstm_architecture.py
TARGET_FRAMES   = 32
LANDMARK_FEATURE = 63
IMAGENET_MEAN   = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD    = np.array([0.229, 0.224, 0.225], dtype=np.float32)
FLOW_NORM_SCALE = 30.0


class GradCAM:
    """
    Computes Grad-CAM heatmaps for ResNetLSTM v2.0 by targeting
    visual_encoder.feature_extractor[7] (ResNet18's layer4).

    The model expects:
        frames    : [B, 32, 5, 224, 224]  — RGB + optical flow
        landmarks : [B, 32, 63]           — hand landmark coords

    NOTE: torch.no_grad() is intentionally NOT used here. Grad-CAM needs the
    forward pass to build a computation graph so gradients can flow backward.
    model.eval() is still set to disable dropout and freeze batch-norm stats.
    """

    def __init__(self, model):
        self.model = model
        self._activations = None
        self._gradients = None

        # visual_encoder.feature_extractor[7] == ResNet18's layer4
        target_layer = model.visual_encoder.feature_extractor[7]
        self._fwd_hook = target_layer.register_forward_hook(self._save_activation)
        self._bwd_hook = target_layer.register_full_backward_hook(self._save_gradient)

    def _save_activation(self, module, input, output):
        self._activations = output  # [batch*32, 512, 7, 7]

    def _save_gradient(self, module, grad_input, grad_output):
        self._gradients = grad_output[0]  # [batch*32, 512, 7, 7]

    def remove_hooks(self):
        self._fwd_hook.remove()
        self._bwd_hook.remove()

    def compute(self, frames, landmarks, class_idx=None):
        """
        frames    : [1, 32, 5, 224, 224] on the correct device.
        landmarks : [1, 32, 63]          on the correct device.
        class_idx : target class index; uses the predicted class if None.
        Returns   : (cam, class_idx) where cam is a float32 numpy array in
                    [0, 1] at the spatial resolution of layer4 (7×7).
        """
        self.model.eval()

        output = self.model(frames, landmarks)  # [1, num_classes]

        if class_idx is None:
            class_idx = output.argmax(dim=1).item()

        self.model.zero_grad()
        output[0, class_idx].backward()

        # Both tensors are [batch*32, 512, 7, 7] for a single clip
        gradients   = self._gradients.detach()    # [32, C, H, W]
        activations = self._activations.detach()  # [32, C, H, W]

        # Global average pool gradients over spatial dims → per-channel weights
        weights = gradients.mean(dim=(2, 3), keepdim=True)  # [32, C, 1, 1]

        # Weighted channel sum → average over the 32 time steps
        cam = (weights * activations).sum(dim=1)  # [32, H, W]
        cam = cam.mean(dim=0)                      # [H, W]

        cam = torch.relu(cam).cpu().numpy()

        if cam.max() > 0:
            cam = cam / cam.max()

        return cam, class_idx


def build_overlay(image_bgr, cam, alpha=0.5):
    """
    Resize cam to 224×224, apply Jet colormap, and blend with the image.
    image_bgr : uint8 numpy array [224, 224, 3] in BGR colour order.
    Returns (overlaid_bgr, heatmap_bgr) as uint8 numpy arrays.
    """
    original_bgr = cv2.resize(image_bgr, (224, 224))

    heatmap = cv2.resize(cam, (224, 224))
    heatmap = np.uint8(255 * heatmap)
    heatmap_bgr = cv2.applyColorMap(heatmap, cv2.COLORMAP_JET)

    overlaid = cv2.addWeighted(original_bgr, 1 - alpha, heatmap_bgr, alpha, 0)
    return overlaid, heatmap_bgr


def _load_clip(clip_path):
    """
    Load a preprocessed clip folder into tensors ready for the v2.0 model.

    Expected folder contents:
        frame0000.jpg … frame0031.jpg  — RGB frames
        optical_flow.npy               — [32, 2, 224, 224]
        landmarks.npy                  — [32, 63]

    Returns:
        frames_tensor    : float32 tensor [1, 32, 5, 224, 224]
        landmarks_tensor : float32 tensor [1, 32, 63]
        frame_jpgs       : list of BGR uint8 arrays for display
    """
    # Load optical flow and landmarks
    flow      = np.load(os.path.join(clip_path, "optical_flow.npy"))   # [32, 2, 224, 224]
    landmarks = np.load(os.path.join(clip_path, "landmarks.npy"))      # [32, 63]

    frame_tensors = []
    frame_jpgs    = []

    for t in range(TARGET_FRAMES):
        jpg_path = os.path.join(clip_path, f"frame{t:04d}.jpg")
        bgr      = cv2.imread(jpg_path)
        bgr      = cv2.resize(bgr, (224, 224))
        frame_jpgs.append(bgr)

        # RGB channels — ImageNet normalisation
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        rgb = (rgb - IMAGENET_MEAN) / IMAGENET_STD                     # [H, W, 3]
        rgb_t = torch.from_numpy(rgb).permute(2, 0, 1)                 # [3, H, W]

        # Optical flow channels — normalise to [-1, 1]
        flow_t = torch.from_numpy(flow[t]).float() / FLOW_NORM_SCALE   # [2, H, W]
        flow_t = torch.clamp(flow_t, -1.0, 1.0)

        frame_tensors.append(torch.cat([rgb_t, flow_t], dim=0))        # [5, H, W]

    frames_tensor    = torch.stack(frame_tensors).unsqueeze(0).float() # [1, 32, 5, 224, 224]
    landmarks_tensor = torch.from_numpy(landmarks).unsqueeze(0).float()# [1, 32, 63]

    return frames_tensor, landmarks_tensor, frame_jpgs


if __name__ == "__main__":
    # --- CONFIGURATION ---
    MODEL_PATH = "./juansignmodel/juansign_model.pth"
    CLIP_PATH  = "./processed_output/frame_extracted/validation_data/A/clip001"
    OUTPUT_PATH = "./visualization_output/gradcam_output.png"
    DISPLAY_FRAME_IDX = 15   # which frame (0–31) to use for the overlay image

    # 1. Device
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    # 2. Load checkpoint — class names come from the checkpoint, not hardcoded
    checkpoint  = torch.load(MODEL_PATH, map_location=device, weights_only=False)
    CLASS_NAMES = checkpoint["class_names"]
    NUM_CLASSES = checkpoint["num_classes"]
    print(f"Classes ({NUM_CLASSES}): {CLASS_NAMES}")

    model = ResNetLSTM(num_classes=NUM_CLASSES).to(device)
    model.load_state_dict(checkpoint["model_state"])
    model.eval()
    print("Model loaded.")

    # 3. Load clip
    frames_tensor, landmarks_tensor, frame_jpgs = _load_clip(CLIP_PATH)
    frames_tensor    = frames_tensor.to(device)
    landmarks_tensor = landmarks_tensor.to(device)

    # 4. Compute Grad-CAM
    gradcam = GradCAM(model)
    cam, predicted_idx = gradcam.compute(frames_tensor, landmarks_tensor)
    gradcam.remove_hooks()

    predicted_class = CLASS_NAMES[predicted_idx]
    print(f"Predicted class : {predicted_class}  (index {predicted_idx})")

    # 5. Build overlay — use RGB of the chosen display frame
    display_bgr = frame_jpgs[DISPLAY_FRAME_IDX]
    overlaid_bgr, heatmap_bgr = build_overlay(display_bgr, cam)

    # 6. Plot and save
    original_rgb = cv2.cvtColor(display_bgr, cv2.COLOR_BGR2RGB)

    fig, axes = plt.subplots(1, 3, figsize=(14, 5))

    axes[0].imshow(original_rgb)
    axes[0].set_title(f"Frame {DISPLAY_FRAME_IDX} (RGB)")
    axes[0].axis("off")

    axes[1].imshow(cam, cmap="jet")
    axes[1].set_title("Grad-CAM (layer4)")
    axes[1].axis("off")

    axes[2].imshow(cv2.cvtColor(overlaid_bgr, cv2.COLOR_BGR2RGB))
    axes[2].set_title(f"Overlay — Predicted: {predicted_class}")
    axes[2].axis("off")

    plt.tight_layout()
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    plt.savefig(OUTPUT_PATH, dpi=300, bbox_inches="tight")
    print(f"Saved to {OUTPUT_PATH}")
    plt.show()
