import torch
import cv2
import numpy as np
import matplotlib.cm as cm
from pathlib import Path
from PIL import Image
from torchvision import transforms

from resnet_lstm_architecture import ResNetLSTM
from gradcam import GradCAM  # project's Grad-CAM implementation (gradcam.py)


FRAME_SIZE = (224, 224)   # must match training resolution
_FONT = cv2.FONT_HERSHEY_SIMPLEX


# ---------------------------------------------------------------------------
# Overlay helpers
# ---------------------------------------------------------------------------

def apply_jet_overlay(cam: np.ndarray, original_float: np.ndarray, alpha: float = 0.5) -> np.ndarray:
    """
    Resize cam to FRAME_SIZE, apply matplotlib Jet, and blend with original.

    cam           : float32 [H, W] in [0, 1]  (layer4 spatial resolution)
    original_float: float32 [H, W, 3] in [0, 1], RGB
    Returns       : uint8 [H, W, 3], RGB
    """
    cam_upscaled = cv2.resize(cam, FRAME_SIZE, interpolation=cv2.INTER_LINEAR)
    heatmap_rgb = cm.jet(cam_upscaled)[:, :, :3]            # RGBA → RGB, float [0,1]
    blended = (1.0 - alpha) * original_float + alpha * heatmap_rgb
    return (np.clip(blended, 0.0, 1.0) * 255).astype(np.uint8)


def _put_label(img: np.ndarray, text: str, origin: tuple, scale: float = 0.45) -> None:
    """Drop-shadow text so labels are readable on any background."""
    x, y = origin
    cv2.putText(img, text, (x + 1, y + 1), _FONT, scale, (0, 0, 0), 2, cv2.LINE_AA)
    cv2.putText(img, text, (x, y), _FONT, scale, (255, 255, 255), 1, cv2.LINE_AA)


def build_video_frame(
    original_bgr: np.ndarray,
    overlay_rgb: np.ndarray,
    frame_idx: int,
    predicted_class: str,
    confidence: float,
) -> np.ndarray:
    """
    Side-by-side composite: [Original 224×224 | Grad-CAM overlay 224×224] → 448×224.
    Annotates both panels and adds predicted class + confidence on the overlay.
    """
    left = original_bgr.copy()
    right = cv2.cvtColor(overlay_rgb, cv2.COLOR_RGB2BGR)

    _put_label(left,  f"Frame {frame_idx:02d}",               (6, 20))
    _put_label(right, "Grad-CAM  layer4",                     (6, 20))
    _put_label(right, f"Pred: {predicted_class}  {confidence:.0f}%", (6, 210))

    return np.hstack([left, right])


# ---------------------------------------------------------------------------
# Clip discovery
# ---------------------------------------------------------------------------

def find_clip_dirs(root: Path) -> list:
    """
    Return sorted list of leaf directories that contain at least one .jpg file.
    Works with both layouts used in this project:
      flat   : root/clip001/*.jpg
      nested : root/<class>/clip001/*.jpg
    """
    return sorted(p for p in root.rglob("*") if p.is_dir() and any(p.glob("*.jpg")))


# ---------------------------------------------------------------------------
# Per-clip processing
# ---------------------------------------------------------------------------

def process_clip(
    clip_path: Path,
    gradcam_engine: GradCAM,
    inference_transform,
    class_names: list,
    output_dir: Path,
    device: torch.device,
    fps: int = 10,
) -> None:
    """
    Process one clip folder → side-by-side diagnostic .mp4.

    For each of the 16 frames:
      1. Tile the single frame into a [1, 16, 3, 224, 224] clip tensor.
      2. Run Grad-CAM (with gradients) to get the layer4 spatial attention map.
      3. Run a separate no_grad pass to read the softmax confidence score.
      4. Compose the video frame and append to the VideoWriter.

    Clips with fewer than 16 frames are skipped with a warning.
    """
    frame_files = sorted(clip_path.glob("frame*.jpg"))[:16]

    if len(frame_files) < 16:
        print(f"  [skip] {clip_path.name}: {len(frame_files)} frame(s) found, need 16.")
        return

    output_path = output_dir / f"{clip_path.name}.mp4"
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = None

    for idx, frame_file in enumerate(frame_files):

        # Original image for the left panel
        original_bgr   = cv2.resize(cv2.imread(str(frame_file)), FRAME_SIZE)
        original_float = cv2.cvtColor(original_bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0

        # Tile single frame → [1, 16, 3, 224, 224]  (GradCAM.compute expects a full clip)
        pil_img  = Image.open(frame_file).convert("RGB")
        frame_t  = inference_transform(pil_img)                                    # [3, 224, 224]
        clip_t   = frame_t.unsqueeze(0).repeat(16, 1, 1, 1).unsqueeze(0).to(device)  # [1, 16, 3, 224, 224]

        # Grad-CAM — gradients required; see gradcam.py for why no_grad is omitted
        cam_map, pred_idx = gradcam_engine.compute(clip_t)   # cam_map: float32 [7, 7] → [0,1]

        # Confidence score (separate pass, no gradient accumulation needed)
        with torch.no_grad():
            logits = gradcam_engine.model(clip_t)
            probs  = torch.nn.functional.softmax(logits, dim=1)
            conf, _ = torch.max(probs, 1)

        predicted_class = class_names[pred_idx]
        confidence      = conf.item() * 100

        # Compose and buffer
        overlay_rgb  = apply_jet_overlay(cam_map, original_float)
        video_frame  = build_video_frame(original_bgr, overlay_rgb, idx, predicted_class, confidence)

        if writer is None:
            h, w = video_frame.shape[:2]
            writer = cv2.VideoWriter(str(output_path), fourcc, fps, (w, h))

        writer.write(video_frame)

    if writer:
        writer.release()

    print(f"  Saved → {output_path.relative_to(output_dir.parent)}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # --- CONFIGURATION ---
    MODEL_PATH = "./juansignmodel/juansign_model.pth"
    INPUT_DIR  = "./processed_output/frame_extracted/testing_data"  # root containing clip subfolders
    OUTPUT_DIR = "../gradcam_videos"                 # output root; mirrored class structure
    CLASS_NAMES = ["A", "B", "C", "J", "O"]
    FPS = 10

    # 1. Device
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    # 2. Model load pattern (same as predict_sign.py)
    model = ResNetLSTM(num_classes=len(CLASS_NAMES)).to(device)
    model.load_state_dict(torch.load(MODEL_PATH, map_location=device))
    model.eval()
    print("Model loaded.\n")

    # 3. Grad-CAM engine — hooks are registered once and reused for every frame
    gradcam_engine = GradCAM(model)

    # 4. Inference transform (no augmentation; same constants as fsl_dataset.py)
    inference_transform = transforms.Compose([
        transforms.Resize(FRAME_SIZE),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    # 5. Discover all clip directories, mirror structure in output root
    input_root  = Path(INPUT_DIR)
    output_root = Path(OUTPUT_DIR)
    output_root.mkdir(parents=True, exist_ok=True)

    clip_dirs = find_clip_dirs(input_root)
    print(f"Found {len(clip_dirs)} clip(s) under '{input_root}'\n")

    for clip_path in clip_dirs:
        relative        = clip_path.relative_to(input_root)
        clip_output_dir = output_root / relative.parent    # preserve class subfolder
        clip_output_dir.mkdir(parents=True, exist_ok=True)
        print(f"Processing: {relative}")
        process_clip(
            clip_path, gradcam_engine, inference_transform,
            CLASS_NAMES, clip_output_dir, device, FPS,
        )

    gradcam_engine.remove_hooks()
    print("\nDone. All hooks removed.")
