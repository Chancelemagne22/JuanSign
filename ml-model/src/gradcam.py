import torch
import numpy as np
import matplotlib.pyplot as plt
import cv2
from PIL import Image
from torchvision import transforms

from resnet_lstm_architecture import ResNetLSTM


class GradCAM:
    """
    Computes Grad-CAM heatmaps for ResNetLSTM by targeting feature_extractor[7]
    (ResNet18's layer4, the last convolutional block).

    The model expects [B, 16, 3, 224, 224] input. For single-frame analysis the
    frame is tiled across all 16 time steps so the full model runs unchanged.

    NOTE: torch.no_grad() is intentionally NOT used here. Grad-CAM needs the
    forward pass to build a computation graph so gradients can flow backward.
    model.eval() is still set to disable dropout and freeze batch-norm stats.
    """

    def __init__(self, model):
        self.model = model
        self._activations = None
        self._gradients = None

        # feature_extractor[7] == ResNet18's layer4 (last conv block)
        target_layer = model.feature_extractor[7]
        self._fwd_hook = target_layer.register_forward_hook(self._save_activation)
        self._bwd_hook = target_layer.register_full_backward_hook(self._save_gradient)

    def _save_activation(self, module, input, output):
        self._activations = output  # [batch*16, 512, 7, 7]

    def _save_gradient(self, module, grad_input, grad_output):
        self._gradients = grad_output[0]  # [batch*16, 512, 7, 7]

    def remove_hooks(self):
        self._fwd_hook.remove()
        self._bwd_hook.remove()

    def compute(self, clip_tensor, class_idx=None):
        """
        clip_tensor : [1, 16, 3, 224, 224] on the correct device.
        class_idx   : target class index; uses the predicted class if None.
        Returns     : (cam, class_idx) where cam is a float32 numpy array in
                      [0, 1] at the spatial resolution of layer4 (7×7).
        """
        self.model.eval()

        output = self.model(clip_tensor)  # [1, num_classes]

        if class_idx is None:
            class_idx = output.argmax(dim=1).item()

        self.model.zero_grad()
        output[0, class_idx].backward()

        # Both tensors are [batch*16, 512, 7, 7] for a single clip
        gradients = self._gradients.detach()    # [16, C, H, W]
        activations = self._activations.detach()  # [16, C, H, W]

        # Global average pool gradients over spatial dims → per-channel weights
        weights = gradients.mean(dim=(2, 3), keepdim=True)   # [16, C, 1, 1]

        # Weighted channel sum → average over the 16 time steps
        cam = (weights * activations).sum(dim=1)  # [16, H, W]
        cam = cam.mean(dim=0)                      # [H, W]

        cam = torch.relu(cam).cpu().numpy()

        if cam.max() > 0:
            cam = cam / cam.max()

        return cam, class_idx


def build_overlay(image_path, cam, alpha=0.5):
    """
    Resize cam to 224×224, apply Jet colormap, and blend with the original image.
    Returns (overlaid_bgr, heatmap_bgr) as uint8 numpy arrays.
    """
    original_bgr = cv2.imread(image_path)
    original_bgr = cv2.resize(original_bgr, (224, 224))

    heatmap = cv2.resize(cam, (224, 224))
    heatmap = np.uint8(255 * heatmap)
    heatmap_bgr = cv2.applyColorMap(heatmap, cv2.COLORMAP_JET)

    overlaid = cv2.addWeighted(original_bgr, 1 - alpha, heatmap_bgr, alpha, 0)
    return overlaid, heatmap_bgr


if __name__ == "__main__":
    # --- CONFIGURATION ---
    MODEL_PATH = "./juansignmodel/juansign_model.pth"
    FRAME_PATH = "./processed_output/frame_extracted/validation_data/J/clip035/frame0007.jpg"            # Path to a single .jpg frame to analyse
    CLASS_NAMES = ["A", "B", "C", "J", "O"]
    OUTPUT_PATH = "gradcam_output.png"
    # 1. Device setup
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    # 2. Model load pattern (same as predict_sign.py)
    model = ResNetLSTM(num_classes=len(CLASS_NAMES)).to(device)
    model.load_state_dict(torch.load(MODEL_PATH, map_location=device))
    model.eval()
    print("Model loaded successfully.")

    # 3. Inference transform — no augmentation, same constants as fsl_dataset.py
    inference_transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    # 4. Load frame and tile into a 16-timestep clip
    image = Image.open(FRAME_PATH).convert("RGB")
    frame_tensor = inference_transform(image)                          # [3, 224, 224]
    clip_tensor = frame_tensor.unsqueeze(0).repeat(16, 1, 1, 1)       # [16, 3, 224, 224]
    clip_tensor = clip_tensor.unsqueeze(0).to(device)                 # [1, 16, 3, 224, 224]

    # 5. Compute Grad-CAM
    gradcam = GradCAM(model)
    cam, predicted_idx = gradcam.compute(clip_tensor)
    gradcam.remove_hooks()

    predicted_class = CLASS_NAMES[predicted_idx]
    print(f"Predicted class : {predicted_class}  (index {predicted_idx})")

    # 6. Build overlay
    overlaid_bgr, heatmap_bgr = build_overlay(FRAME_PATH, cam)

    # 7. Plot and save
    original_rgb = cv2.cvtColor(
        cv2.resize(cv2.imread(FRAME_PATH), (224, 224)), cv2.COLOR_BGR2RGB
    )

    fig, axes = plt.subplots(1, 3, figsize=(14, 5))

    axes[0].imshow(original_rgb)
    axes[0].set_title("Original Frame")
    axes[0].axis("off")

    axes[1].imshow(cam, cmap="jet")
    axes[1].set_title("Grad-CAM (layer4)")
    axes[1].axis("off")

    axes[2].imshow(cv2.cvtColor(overlaid_bgr, cv2.COLOR_BGR2RGB))
    axes[2].set_title(f"Overlay — Predicted: {predicted_class}")
    axes[2].axis("off")

    plt.tight_layout()
    plt.savefig(OUTPUT_PATH, dpi=300, bbox_inches="tight")
    print(f"Saved to {OUTPUT_PATH}")
    plt.show()
