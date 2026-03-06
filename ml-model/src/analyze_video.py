"""
JuanSign — Video Analysis Pipeline
====================================
Accepts a pre-recorded video file, slices it into non-overlapping 16-frame
clips, runs each clip through the CNN-ResNet-LSTM model, and writes a richly
annotated output video.

Panel layout (default)
-----------------------
┌─────────────────────────────────────────────────────────────────────────────┐
│  Original frame (t=N)  │  Grad-CAM overlay  │  LSTM hidden-state heatmap  │
├────────────────────────────────────────────┬────────────────────────────────┤
│  PCA trajectory (ResNet features, 2-D)     │  Prediction box               │
├─────────────────────────────────────────────────────────────────────────────┤
│  Confidence timeline strip (all clips so far)                              │
└─────────────────────────────────────────────────────────────────────────────┘

Canvas: 960 × 544 px

Overlay-only mode (--overlay-only)
------------------------------------
Grad-CAM is blended directly onto the original frame and the prediction label
is burned in. Output is the same dimensions as the source video.

Bonus features
--------------
  --pdf  PATH   Export a per-clip summary PDF (one page per clip):
                raw-frame grid · Grad-CAM grid · LSTM heatmap · PCA trajectory

Usage
-----
  # Full panel layout
  python analyze_video.py --source demo.mp4

  # Overlay-only
  python analyze_video.py --source demo.mp4 --overlay-only

  # With PDF export
  python analyze_video.py --source demo.mp4 --pdf report.pdf

  # Custom output path + FPS
  python analyze_video.py --source demo.mp4 --output out.mp4 --fps 10
"""

# ── std-lib ────────────────────────────────────────────────────────────────────
import argparse
import io
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

# ── third-party — matplotlib MUST set backend before pyplot import ─────────────
import matplotlib
matplotlib.use("Agg")                          # headless; no display required
import matplotlib.pyplot as plt                # noqa: E402
import matplotlib.patches as mpatches         # noqa: E402
from matplotlib.backends.backend_pdf import PdfPages  # noqa: E402

import cv2                                     # noqa: E402
import numpy as np                             # noqa: E402
import torch                                   # noqa: E402
from PIL import Image                          # noqa: E402
from torchvision import transforms             # noqa: E402

# ── sklearn (optional — PCA panel is skipped if absent) ───────────────────────
try:
    from sklearn.decomposition import PCA as _PCA
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False
    print("WARNING: scikit-learn not installed — PCA panel will be skipped.")

# ── mediapipe + hand-crop helpers ─────────────────────────────────────────────
try:
    import mediapipe as mp                                    # noqa: E402
    from mediapipe.tasks import python as _mp_python          # noqa: E402
    from mediapipe.tasks.python import vision as _mp_vision   # noqa: E402
    from frame_extractor import _center_crop                  # noqa: E402  (fallback only)
    HAS_MEDIAPIPE = True
except ImportError:
    HAS_MEDIAPIPE = False
    print("WARNING: mediapipe not installed — hand crop disabled (center-crop fallback).")

# ── resolve sibling modules ───────────────────────────────────────────────────
_SRC_DIR = os.path.dirname(os.path.abspath(__file__))
_ML_DIR  = os.path.abspath(os.path.join(_SRC_DIR, ".."))
sys.path.insert(0, _SRC_DIR)

from resnet_lstm_architecture import ResNetLSTM  # noqa: E402
from gradcam import GradCAM                      # noqa: E402


# ──────────────────────────────────────────────────────────────────────────────
# Constants — must match training pipeline exactly
# ──────────────────────────────────────────────────────────────────────────────

NUM_FRAMES  = 16
IMG_SIZE    = 224
MEAN        = [0.485, 0.456, 0.406]
STD         = [0.229, 0.224, 0.225]
CLASS_NAMES = [
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
    "N", "N~", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
]

# Panel / canvas geometry (panel mode)
PANEL_W    = 320
PANEL_H    = 240
TIMELINE_H = 64
CANVAS_W   = PANEL_W * 3          # 960
CANVAS_H   = PANEL_H * 2 + TIMELINE_H  # 544

# Dark-theme background colours (BGR)
BG_DARK  = (13, 13, 26)
BG_PANEL = (18, 18, 30)

# Hand-crop settings
HAND_PADDING  = 60    # base padding in px — matches frame_extractor.py training value
CROP_DISPLAY  = 480   # output resolution (square) for overlay-only mode


_TRANSFORM = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(mean=MEAN, std=STD),
])


# ──────────────────────────────────────────────────────────────────────────────
# MediaPipe hand-crop helpers
# ──────────────────────────────────────────────────────────────────────────────

def _build_hand_detector():
    """
    Return a MediaPipe HandLandmarker (Task API, IMAGE mode, single hand).
    Returns None when mediapipe is not installed.
    Uses a relative path (same as frame_extractor.py) to avoid C++ encoding
    issues with non-ASCII characters in absolute Windows paths.
    """
    if not HAS_MEDIAPIPE:
        return None
    opts = _mp_vision.HandLandmarkerOptions(
        base_options=_mp_python.BaseOptions(model_asset_path="hand_landmarker.task"),
        running_mode=_mp_vision.RunningMode.IMAGE,
        num_hands=1,
    )
    return _mp_vision.HandLandmarker.create_from_options(opts)


def _hand_crop_inference(bgr: np.ndarray, hand_detector) -> Optional[np.ndarray]:
    """
    Detect the dominant hand via 21 MediaPipe landmarks and return a crop.

    Padding strategy:
      • HAND_PADDING (60 px) on each side — identical to frame_extractor.py so
        the spatial context matches what the model was trained on.
      • +5% expansion of the padded bbox on each side — gives inference a
        slightly larger context window for cases where landmark tracking is
        slightly off at the edges.

    Returns None when no hand is detected (caller should use _center_crop).
    """
    h, w     = bgr.shape[:2]
    rgb      = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    results  = hand_detector.detect(mp_image)
    if not results.hand_landmarks:
        return None

    lm = results.hand_landmarks[0]
    xs = [pt.x * w for pt in lm]
    ys = [pt.y * h for pt in lm]

    x1 = max(0, int(min(xs)) - HAND_PADDING)
    y1 = max(0, int(min(ys)) - HAND_PADDING)
    x2 = min(w, int(max(xs)) + HAND_PADDING)
    y2 = min(h, int(max(ys)) + HAND_PADDING)

    if x2 <= x1 or y2 <= y1:
        return None

    # +5% expansion of the padded bbox on each side
    extra_x = int((x2 - x1) * 0.05)
    extra_y = int((y2 - y1) * 0.05)
    x1 = max(0, x1 - extra_x)
    y1 = max(0, y1 - extra_y)
    x2 = min(w, x2 + extra_x)
    y2 = min(h, y2 + extra_y)

    return bgr[y1:y2, x1:x2]


def preprocess_clip_frames(
    clip_frames:  List[np.ndarray],
    hand_detector,
) -> Tuple[List[np.ndarray], int]:
    """
    Crop every frame in a clip to the hand region before model inference.

    Each frame:
      1. _hand_crop_inference → hand bbox + HAND_PADDING + 5% expansion
      2. _center_crop fallback if no hand is detected

    Returns (crops, hand_hits) where hand_hits is the number of frames in which
    an actual hand was detected (not a fallback center-crop).  A clip with
    hand_hits == 0 should be skipped — no hand appeared at all.
    """
    crops     = []
    hand_hits = 0
    for bgr in clip_frames:
        if hand_detector is not None:
            crop = _hand_crop_inference(bgr, hand_detector)
        else:
            crop = None
        if crop is not None:
            hand_hits += 1
            crops.append(crop)
        else:
            crops.append(_center_crop(bgr))
    return crops, hand_hits


# ──────────────────────────────────────────────────────────────────────────────
# Result container
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class ClipResult:
    clip_idx:        int
    label:           str
    confidence:      float
    class_idx:       int
    raw_frames:      List[np.ndarray]    # 16 BGR ndarrays (hand-cropped)
    resnet_features: np.ndarray          # [16, 512]
    lstm_hidden:     np.ndarray          # [16, 256]
    cam:             np.ndarray          # [7, 7] float32 in [0, 1]
    hand_hits:       int                 # frames where hand was actually detected
    pca_proj:        Optional[np.ndarray] = None   # [16, 2]

    @property
    def is_valid(self) -> bool:
        """True when at least one frame contained a detected hand."""
        return self.hand_hits > 0


# ──────────────────────────────────────────────────────────────────────────────
# Forward-hook helpers
# ──────────────────────────────────────────────────────────────────────────────

class ResNetFeatureCapture:
    """
    Hooks on model.feature_extractor (the whole Sequential, including avgpool).
    After a forward pass: self.features holds [B*T, 512, 1, 1].
    """
    def __init__(self, model: ResNetLSTM) -> None:
        self.features: Optional[torch.Tensor] = None
        self._hook = model.feature_extractor.register_forward_hook(self._capture)

    def _capture(self, module, input, output) -> None:
        self.features = output.detach().cpu()   # [B*T, 512, 1, 1]

    def remove(self) -> None:
        self._hook.remove()


class LSTMFullStateCapture:
    """
    Hooks on model.lstm.
    After a forward pass: self.lstm_out holds [B, T, hidden_size].
    """
    def __init__(self, model: ResNetLSTM) -> None:
        self.lstm_out: Optional[torch.Tensor] = None
        self._hook = model.lstm.register_forward_hook(self._capture)

    def _capture(self, module, input, output) -> None:
        seq_out, _ = output          # seq_out: [B, T, 256]
        self.lstm_out = seq_out.detach().cpu()

    def remove(self) -> None:
        self._hook.remove()


# ──────────────────────────────────────────────────────────────────────────────
# Model + preprocessing
# ──────────────────────────────────────────────────────────────────────────────

def load_model(model_path: str, num_classes: int,
               device: torch.device) -> ResNetLSTM:
    m = ResNetLSTM(num_classes=num_classes).to(device)
    m.load_state_dict(
        torch.load(model_path, map_location=device, weights_only=True))
    m.eval()
    return m


def frames_to_tensor(frames: List[np.ndarray],
                     device: torch.device) -> torch.Tensor:
    """
    16 BGR ndarrays → [1, 16, 3, 224, 224] on `device`.
    Frames must already be hand-cropped via preprocess_clip_frames().
    """
    tensors = []
    for bgr in frames:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        tensors.append(_TRANSFORM(Image.fromarray(rgb)))
    return torch.stack(tensors).unsqueeze(0).to(device)


def extract_clips(video_path: str,
                  num_frames: int = NUM_FRAMES) -> List[List[np.ndarray]]:
    """
    Read the video and split into non-overlapping clips of `num_frames` frames.
    Partial trailing clips (< num_frames) are discarded.
    Returns a list of clips; each clip is a list of BGR ndarrays.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise IOError(f"Cannot open video: {video_path}")
    clips, buf = [], []
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        buf.append(frame)
        if len(buf) == num_frames:
            clips.append(buf)
            buf = []
    cap.release()
    return clips


# ──────────────────────────────────────────────────────────────────────────────
# Per-clip analysis
# ──────────────────────────────────────────────────────────────────────────────

def analyze_clip(
    model:        ResNetLSTM,
    clip_frames:  List[np.ndarray],
    class_names:  List[str],
    feat_cap:     ResNetFeatureCapture,
    lstm_cap:     LSTMFullStateCapture,
    gradcam_fn:   GradCAM,
    device:       torch.device,
    clip_idx:     int,
    hand_detector=None,
) -> ClipResult:
    """
    Run the full analysis pipeline for one 16-frame clip:
      0. Preprocess       → hand crop + 5% expansion per frame (center-crop fallback)
      1. No-grad forward  → prediction, ResNet features, LSTM hidden states
      2. Grad-CAM         → saliency heatmap (overwrites hook captures, but we
                            already saved the data from step 1)
      3. PCA              → 2-D projection of the 16 ResNet feature vectors
    """
    # ── Step 0: crop every frame to the hand region ────────────────────────────
    crop_frames, hand_hits = preprocess_clip_frames(clip_frames, hand_detector)

    # ── No-hand gate: skip model inference if no hand appeared in any frame ────
    if hand_hits == 0:
        _blank_f = np.zeros((NUM_FRAMES, 512), dtype=np.float32)
        _blank_h = np.zeros((NUM_FRAMES, 256), dtype=np.float32)
        _blank_c = np.zeros((7, 7),            dtype=np.float32)
        return ClipResult(
            clip_idx=clip_idx,
            label="—",
            confidence=0.0,
            class_idx=-1,
            raw_frames=crop_frames,
            resnet_features=_blank_f,
            lstm_hidden=_blank_h,
            cam=_blank_c,
            hand_hits=0,
        )

    clip_tensor = frames_to_tensor(crop_frames, device)               # [1, 16, 3, 224, 224]

    # ── Step 1: no-grad forward ────────────────────────────────────────────────
    with torch.no_grad():
        out   = model(clip_tensor)
        probs = torch.softmax(out, dim=1)
        conf, idx = probs.max(dim=1)

    label      = class_names[idx.item()]
    confidence = conf.item() * 100.0
    class_idx  = idx.item()

    # Grab hook captures NOW before Grad-CAM's forward pass overwrites them.
    # feat_cap.features : [B*T, 512, 1, 1] → squeeze → [T, 512]
    # lstm_cap.lstm_out : [B, T, 256]      → [0]     → [T, 256]
    resnet_features = feat_cap.features.squeeze(-1).squeeze(-1).numpy()  # [16, 512]
    lstm_hidden     = lstm_cap.lstm_out[0].numpy()                        # [16, 256]

    # ── Step 2: Grad-CAM (forward + backward with gradients) ──────────────────
    cam, _ = gradcam_fn.compute(clip_tensor, class_idx=class_idx)
    # cam: float32 numpy array [7, 7] in [0, 1]

    # ── Step 3: PCA on per-frame ResNet features ───────────────────────────────
    pca_proj = None
    if HAS_SKLEARN:
        try:
            pca_proj = _PCA(n_components=2).fit_transform(resnet_features)
        except Exception:
            pass

    return ClipResult(
        clip_idx=clip_idx,
        label=label,
        confidence=confidence,
        class_idx=class_idx,
        raw_frames=crop_frames,
        resnet_features=resnet_features,
        lstm_hidden=lstm_hidden,
        cam=cam,
        hand_hits=hand_hits,
        pca_proj=pca_proj,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Rendering utilities
# ──────────────────────────────────────────────────────────────────────────────

def _fig_to_bgr(fig: plt.Figure,
                size: Optional[Tuple[int, int]] = None) -> np.ndarray:
    """Rasterise a matplotlib Figure to a BGR uint8 ndarray, then close it."""
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight",
                pad_inches=0.05, facecolor=fig.get_facecolor())
    plt.close(fig)
    buf.seek(0)
    img_rgb = np.array(Image.open(buf))[:, :, :3]
    img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    if size:
        img_bgr = cv2.resize(img_bgr, size)
    return img_bgr


def _blend_cam(frame_bgr: np.ndarray, cam: np.ndarray,
               alpha: float = 0.45) -> np.ndarray:
    """Resize cam to frame size, apply JET colourmap, and blend."""
    h, w  = frame_bgr.shape[:2]
    hmap  = cv2.resize(cam, (w, h), interpolation=cv2.INTER_LINEAR)
    hmap8 = np.uint8(255 * hmap)
    color = cv2.applyColorMap(hmap8, cv2.COLORMAP_JET)
    return cv2.addWeighted(frame_bgr, 1 - alpha, color, alpha, 0)


# ── Panel renderers ────────────────────────────────────────────────────────────

def render_gradcam_panel(frame_bgr: np.ndarray, cam: np.ndarray,
                          label: str, conf: float,
                          size: Tuple[int, int] = (PANEL_W, PANEL_H)) -> np.ndarray:
    """Grad-CAM overlay for the current frame, resized to `size`."""
    panel = cv2.resize(_blend_cam(frame_bgr, cam, alpha=0.45), size)
    cv2.putText(panel, "Grad-CAM", (6, 18),
                cv2.FONT_HERSHEY_SIMPLEX, 0.48, (220, 220, 220), 1, cv2.LINE_AA)
    cv2.putText(panel, f"{label}  {conf:.1f}%", (6, 40),
                cv2.FONT_HERSHEY_SIMPLEX, 0.70, (0, 255, 128), 2, cv2.LINE_AA)
    return panel


def render_lstm_heatmap(lstm_hidden: np.ndarray, frame_idx: int,
                         size: Tuple[int, int] = (PANEL_W, PANEL_H)) -> np.ndarray:
    """
    2-D heatmap of LSTM hidden states.
    X-axis → 16 timesteps.  Y-axis → first 64 hidden dimensions.
    A white vertical line marks the current frame index.
    """
    fig, ax = plt.subplots(figsize=(size[0] / 100, size[1] / 100), dpi=100,
                            facecolor="#0d0d1a")
    ax.set_facecolor("#0d0d1a")

    data = lstm_hidden[:, :64].T          # [64, 16]
    ax.imshow(data, aspect="auto", cmap="plasma", origin="lower",
              interpolation="nearest")
    ax.axvline(x=frame_idx, color="white", linewidth=1.5, alpha=0.85)

    ax.set_title("LSTM Hidden States", color="white", fontsize=7, pad=2)
    ax.set_xlabel("Timestep", color="#aaaaaa", fontsize=6)
    ax.set_ylabel("Dim 0–63",  color="#aaaaaa", fontsize=6)
    ax.tick_params(colors="#777777", labelsize=5)
    for sp in ax.spines.values():
        sp.set_edgecolor("#444444")

    plt.tight_layout(pad=0.3)
    return _fig_to_bgr(fig, size)


def render_pca_panel(pca_proj: Optional[np.ndarray], frame_idx: int,
                      size: Tuple[int, int] = (PANEL_W, PANEL_H)) -> np.ndarray:
    """
    2-D PCA trajectory of the 16 ResNet feature vectors, coloured by timestep
    (plasma colourmap: purple=early, yellow=late).
    The current frame is highlighted with a white ring.
    """
    if pca_proj is None:
        blank = np.full((size[1], size[0], 3), 22, dtype=np.uint8)
        cv2.putText(blank, "PCA unavailable", (8, size[1] // 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (100, 100, 100), 1)
        return blank

    cmap   = plt.cm.plasma
    colors = [cmap(i / (NUM_FRAMES - 1)) for i in range(NUM_FRAMES)]

    fig, ax = plt.subplots(figsize=(size[0] / 100, size[1] / 100), dpi=100,
                            facecolor="#0d0d1a")
    ax.set_facecolor("#0d0d1a")

    # Trajectory lines coloured by segment
    for i in range(NUM_FRAMES - 1):
        ax.plot(pca_proj[i:i+2, 0], pca_proj[i:i+2, 1],
                color=colors[i], linewidth=1.2, alpha=0.7)

    # Scatter all points
    ax.scatter(pca_proj[:, 0], pca_proj[:, 1],
               c=range(NUM_FRAMES), cmap="plasma",
               s=28, alpha=0.75, zorder=3)

    # Highlight current frame
    ax.scatter(pca_proj[frame_idx, 0], pca_proj[frame_idx, 1],
               s=110, facecolors="white", edgecolors="black",
               linewidths=1.5, zorder=4)

    # Colourbar — timestep legend
    sm = plt.cm.ScalarMappable(cmap=cmap,
                                norm=plt.Normalize(0, NUM_FRAMES - 1))
    sm.set_array([])
    cb = fig.colorbar(sm, ax=ax, fraction=0.042, pad=0.02)
    cb.ax.tick_params(labelsize=4, colors="#aaaaaa")
    cb.set_label("Timestep", color="#aaaaaa", fontsize=5)
    cb.outline.set_edgecolor("#444444")

    ax.set_title(f"PCA Trajectory  t={frame_idx:02d}",
                 color="white", fontsize=7, pad=2)
    ax.tick_params(colors="#777777", labelsize=5)
    for sp in ax.spines.values():
        sp.set_edgecolor("#333333")

    plt.tight_layout(pad=0.3)
    return _fig_to_bgr(fig, size)


def render_prediction_panel(label: str, conf: float,
                              clip_idx: int, total_clips: int,
                              size: Tuple[int, int] = (PANEL_W, PANEL_H)) -> np.ndarray:
    """
    Large prediction letter + confidence gauge bar.
    Bar colour: green ≥ 70 %, orange ≥ 50 %, red otherwise.
    """
    bar_col = "#00c853" if conf >= 70 else "#ff9800" if conf >= 50 else "#f44336"

    fig, ax = plt.subplots(figsize=(size[0] / 100, size[1] / 100), dpi=100,
                            facecolor="#0d1117")
    ax.set_facecolor("#0d1117")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    # Predicted sign letter
    ax.text(0.5, 0.72, label, ha="center", va="center",
            fontsize=56, fontweight="bold", color="#00ff88",
            fontfamily="monospace")

    # Numeric confidence
    ax.text(0.5, 0.50, f"{conf:.1f}%", ha="center", va="center",
            fontsize=15, color="#ffffff")

    # Gauge bar
    ax.add_patch(mpatches.Rectangle(
        (0.08, 0.30), 0.84, 0.09, facecolor="#2a2a3e", edgecolor="#555"))
    ax.add_patch(mpatches.Rectangle(
        (0.08, 0.30), 0.84 * conf / 100, 0.09,
        facecolor=bar_col, edgecolor="none"))

    ax.text(0.5, 0.18, f"Clip {clip_idx + 1} / {total_clips}",
            ha="center", va="center", fontsize=7, color="#888888")
    ax.text(0.5, 0.06, "FSL Prediction",
            ha="center", va="center", fontsize=6, color="#555555")

    plt.tight_layout(pad=0.2)
    return _fig_to_bgr(fig, size)


def render_confidence_strip(
    history:     List[Tuple[str, float]],
    total_clips: int,
    width:       int = CANVAS_W,
    height:      int = TIMELINE_H,
) -> np.ndarray:
    """
    Horizontal confidence timeline — one bar per processed clip.
    Bar colour mirrors the prediction confidence level.
    The most recent bar gets a white border to mark the current clip.
    """
    if not history:
        strip = np.full((height, width, 3), 20, dtype=np.uint8)
        cv2.putText(strip, "Confidence Timeline", (8, height // 2 + 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, (70, 70, 70), 1)
        return strip

    n_done = len(history)
    confs  = [h[1] for h in history]
    labels = [h[0] for h in history]
    xs     = list(range(n_done))

    # Skipped clips (label "—") shown as a dim gray stub at 5 % height
    plot_confs = [5.0 if lbl == "—" else c for lbl, c in zip(labels, confs)]
    bar_colors = [
        "#3a3a3a" if lbl == "—"
        else "#00c853" if c >= 70
        else "#ff9800" if c >= 50
        else "#f44336"
        for lbl, c in zip(labels, confs)
    ]

    fig, ax = plt.subplots(figsize=(width / 100, height / 100), dpi=100,
                            facecolor="#0d0d0d")
    ax.set_facecolor("#0d0d0d")

    bars = ax.bar(xs, plot_confs, color=bar_colors, width=0.85, align="center")

    # White border on the current (last) bar
    bars[-1].set_edgecolor("white")
    bars[-1].set_linewidth(1.4)

    # Letter labels on bars when there are few enough clips to be readable
    if n_done <= 40:
        font_size = max(4, 7 - n_done // 12)
        for i, (lbl, c) in enumerate(zip(labels, plot_confs)):
            ax.text(i, c + 1.5, lbl, ha="center", va="bottom",
                    color="#666666" if lbl == "—" else "white",
                    fontsize=font_size, fontweight="bold")

    ax.set_xlim(-0.6, max(total_clips, n_done) - 0.4)
    ax.set_ylim(0, 112)
    ax.set_ylabel("%", color="#777777", fontsize=5, labelpad=1)
    ax.set_title("Confidence Timeline", color="#888888", fontsize=5, pad=1)
    ax.tick_params(colors="#555555", labelsize=4, bottom=False, labelbottom=False)
    for sp in ax.spines.values():
        sp.set_edgecolor("#2a2a2a")

    plt.tight_layout(pad=0.1)
    return _fig_to_bgr(fig, (width, height))


# ── Panel layout compositor ───────────────────────────────────────────────────

def compose_panel_frame(
    frame_bgr:   np.ndarray,
    result:      ClipResult,
    frame_idx:   int,
    history:     List[Tuple[str, float]],
    total_clips: int,
) -> np.ndarray:
    """
    Build the full 960 × 544 composite for one video frame.

    Row 1 (960 × 240): [Original | Grad-CAM | LSTM heatmap]
    Row 2 (960 × 240): [PCA trajectory (640 w) | Prediction box (320 w)]
    Row 3 (960 × 64):  [Confidence timeline strip]
    """
    p = (PANEL_W, PANEL_H)   # 320 × 240

    # ── Row 1 ─────────────────────────────────────────────────────────────────
    orig = cv2.resize(frame_bgr, p)
    cv2.putText(orig, f"Frame {frame_idx + 1:02d}/{NUM_FRAMES}",
                (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.44,
                (200, 200, 200), 1, cv2.LINE_AA)
    cv2.putText(orig, "Original", (6, 36),
                cv2.FONT_HERSHEY_SIMPLEX, 0.40, (140, 140, 140), 1, cv2.LINE_AA)

    gcam = render_gradcam_panel(frame_bgr, result.cam,
                                 result.label, result.confidence, p)
    lstm = render_lstm_heatmap(result.lstm_hidden, frame_idx, p)

    row1 = np.hstack([orig, gcam, lstm])          # [240, 960, 3]

    # ── Row 2 ─────────────────────────────────────────────────────────────────
    pca_size  = (CANVAS_W * 2 // 3, PANEL_H)      # 640 × 240
    pred_size = (CANVAS_W - pca_size[0], PANEL_H)  # 320 × 240

    pca  = render_pca_panel(result.pca_proj, frame_idx, pca_size)
    pred = render_prediction_panel(result.label, result.confidence,
                                    result.clip_idx, total_clips, pred_size)

    row2 = np.hstack([pca, pred])                 # [240, 960, 3]

    # ── Row 3: timeline ───────────────────────────────────────────────────────
    tline = render_confidence_strip(history, total_clips, CANVAS_W, TIMELINE_H)

    return np.vstack([row1, row2, tline])          # [544, 960, 3]


# ── Overlay-only compositor ───────────────────────────────────────────────────

def render_overlay_frame(frame_bgr: np.ndarray, cam: np.ndarray,
                          label: str, conf: float) -> np.ndarray:
    """
    Blend Grad-CAM onto the original frame and burn in the prediction text.
    Output matches the input frame dimensions.
    """
    out = _blend_cam(frame_bgr, cam, alpha=0.45)

    h, w = out.shape[:2]

    # Semi-transparent dark HUD strip at top
    strip = out.copy()
    cv2.rectangle(strip, (0, 0), (w, 68), (0, 0, 0), -1)
    cv2.addWeighted(strip, 0.58, out, 0.42, 0, out)

    cv2.putText(out, label, (14, 48),
                cv2.FONT_HERSHEY_SIMPLEX, 1.9, (0, 255, 128), 3, cv2.LINE_AA)
    cv2.putText(out, f"{conf:.1f}%", (100 if len(label) == 1 else 120, 48),
                cv2.FONT_HERSHEY_SIMPLEX, 1.05, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(out, "Grad-CAM", (w - 88, 18),
                cv2.FONT_HERSHEY_SIMPLEX, 0.38, (180, 180, 180), 1, cv2.LINE_AA)
    return out


# ──────────────────────────────────────────────────────────────────────────────
# PDF export  (one page per clip)
# ──────────────────────────────────────────────────────────────────────────────

def export_pdf(results: List[ClipResult], pdf_path: str) -> None:
    """
    Write a landscape A4/Letter PDF with one page per clip.

    Each page contains:
      • Header: clip number + prediction + confidence
      • Top-left  4 × 4 grid : raw frames (thumbnails)
      • Top-right 4 × 4 grid : Grad-CAM overlay frames
      • Bottom-left panel     : LSTM hidden-state heatmap
      • Bottom-right panel    : PCA trajectory
    """
    print(f"\nExporting PDF → {pdf_path}")
    with PdfPages(pdf_path) as pdf:
        for r in results:
            fig = plt.figure(figsize=(11, 8.5), facecolor="#0d0d0d")
            fig.suptitle(
                f"Clip {r.clip_idx + 1}  —  Predicted: {r.label}  "
                f"({r.confidence:.1f}%)",
                color="white", fontsize=13, fontweight="bold", y=0.98,
            )

            # 2-row × 2-col outer grid; rows: [frame grids, analysis panels]
            gs_outer = fig.add_gridspec(
                2, 2,
                left=0.03, right=0.97,
                top=0.93, bottom=0.03,
                hspace=0.40, wspace=0.20,
                height_ratios=[3, 1.4],
            )

            # ── Raw frames: nested 4 × 4 in top-left ──────────────────────────
            gs_raw = gs_outer[0, 0].subgridspec(4, 4, hspace=0.35, wspace=0.25)
            cam_th = cv2.resize(r.cam, (112, 84), interpolation=cv2.INTER_LINEAR)
            for fi in range(NUM_FRAMES):
                row_i, col_i = fi // 4, fi % 4
                ax = fig.add_subplot(gs_raw[row_i, col_i])
                thumb = cv2.resize(r.raw_frames[fi], (112, 84))
                ax.imshow(cv2.cvtColor(thumb, cv2.COLOR_BGR2RGB))
                ax.set_title(f"f{fi}", color="#cccccc", fontsize=5, pad=1)
                ax.axis("off")

            # Section label
            fig.text(0.03 + (0.97 - 0.03) * 0.25 / 2, 0.965,
                     "Raw Frames", ha="center", color="#aaaaaa", fontsize=8)

            # ── Grad-CAM overlay frames: nested 4 × 4 in top-right ────────────
            gs_gcam = gs_outer[0, 1].subgridspec(4, 4, hspace=0.35, wspace=0.25)
            for fi in range(NUM_FRAMES):
                row_i, col_i = fi // 4, fi % 4
                ax = fig.add_subplot(gs_gcam[row_i, col_i])
                thumb = cv2.resize(r.raw_frames[fi], (112, 84))
                hmap8 = np.uint8(255 * cam_th)
                color_map = cv2.applyColorMap(hmap8, cv2.COLORMAP_JET)
                blended   = cv2.addWeighted(thumb, 0.55, color_map, 0.45, 0)
                ax.imshow(cv2.cvtColor(blended, cv2.COLOR_BGR2RGB))
                ax.set_title(f"f{fi}", color="#cccccc", fontsize=5, pad=1)
                ax.axis("off")

            fig.text(0.03 + (0.97 - 0.03) * 0.75, 0.965,
                     "Grad-CAM Overlay", ha="center", color="#aaaaaa", fontsize=8)

            # ── LSTM hidden-state heatmap (bottom-left) ────────────────────────
            ax_lstm = fig.add_subplot(gs_outer[1, 0])
            ax_lstm.set_facecolor("#0d0d1a")
            im = ax_lstm.imshow(
                r.lstm_hidden[:, :64].T,
                aspect="auto", cmap="plasma", origin="lower",
            )
            ax_lstm.set_title("LSTM Hidden States (dims 0–63)",
                               color="white", fontsize=8)
            ax_lstm.set_xlabel("Timestep", color="#aaaaaa", fontsize=7)
            ax_lstm.set_ylabel("Dim",       color="#aaaaaa", fontsize=7)
            ax_lstm.tick_params(colors="#888888", labelsize=6)
            for sp in ax_lstm.spines.values():
                sp.set_edgecolor("#444444")
            fig.colorbar(im, ax=ax_lstm, fraction=0.04, pad=0.02,
                         ).ax.tick_params(labelsize=6, colors="#aaaaaa")

            # ── PCA trajectory (bottom-right) ──────────────────────────────────
            ax_pca = fig.add_subplot(gs_outer[1, 1])
            ax_pca.set_facecolor("#0d0d1a")

            if r.pca_proj is not None:
                cmap_pca = plt.cm.plasma
                for i in range(NUM_FRAMES - 1):
                    c = cmap_pca(i / (NUM_FRAMES - 1))
                    ax_pca.plot(r.pca_proj[i:i+2, 0], r.pca_proj[i:i+2, 1],
                                color=c, linewidth=1.5)
                sc = ax_pca.scatter(
                    r.pca_proj[:, 0], r.pca_proj[:, 1],
                    c=range(NUM_FRAMES), cmap="plasma", s=40, zorder=3,
                )
                fig.colorbar(sc, ax=ax_pca, fraction=0.04, pad=0.02,
                             label="Timestep").ax.tick_params(
                    labelsize=6, colors="#aaaaaa")
                ax_pca.set_title("PCA Trajectory (ResNet features)",
                                  color="white", fontsize=8)
            else:
                ax_pca.text(0.5, 0.5, "PCA unavailable\n(install scikit-learn)",
                            ha="center", va="center", color="#888888",
                            transform=ax_pca.transAxes, fontsize=9)

            ax_pca.tick_params(colors="#888888", labelsize=6)
            for sp in ax_pca.spines.values():
                sp.set_edgecolor("#444444")

            pdf.savefig(fig, facecolor=fig.get_facecolor())
            plt.close(fig)

    print(f"PDF saved → {pdf_path}")


# ──────────────────────────────────────────────────────────────────────────────
# No-hand / Right-Prediction rendering helpers
# ──────────────────────────────────────────────────────────────────────────────

def _cross_out(bgr: np.ndarray) -> np.ndarray:
    """
    Darken the frame, draw two red diagonal lines forming an X, and label it
    'NO HAND DETECTED'.  Used in overlay-only mode for skipped clips.
    """
    out = cv2.addWeighted(bgr, 0.28, np.zeros_like(bgr), 0.72, 0)
    h, w  = out.shape[:2]
    thick = max(2, h // 55)
    col   = (40, 40, 220)
    cv2.line(out, (int(w * 0.07), int(h * 0.07)),
             (int(w * 0.93), int(h * 0.93)), col, thick, cv2.LINE_AA)
    cv2.line(out, (int(w * 0.93), int(h * 0.07)),
             (int(w * 0.07), int(h * 0.93)), col, thick, cv2.LINE_AA)
    scale = max(0.45, h / 480)
    cv2.putText(out, "NO HAND DETECTED",
                (int(w * 0.05), h // 2 - int(h * 0.04)),
                cv2.FONT_HERSHEY_SIMPLEX, scale, (80, 80, 255), 2, cv2.LINE_AA)
    cv2.putText(out, "PREDICTION SKIPPED",
                (int(w * 0.05), h // 2 + int(h * 0.07)),
                cv2.FONT_HERSHEY_SIMPLEX, scale * 0.75, (140, 140, 255), 1, cv2.LINE_AA)
    return out


def _add_no_hand_banner(bgr: np.ndarray) -> np.ndarray:
    """
    Overlay a translucent red banner at the top of a panel-mode canvas.
    Used for skipped clips so the viewer sees 'NO HAND — SKIPPED' across
    the full 960 × 544 panel without destroying the underlying panels.
    """
    out      = bgr.copy()
    h, w     = out.shape[:2]
    banner_h = max(28, h // 14)
    overlay  = out.copy()
    cv2.rectangle(overlay, (0, 0), (w, banner_h), (20, 20, 180), -1)
    cv2.addWeighted(overlay, 0.72, out, 0.28, 0, out)
    scale = max(0.38, banner_h / 65)
    cv2.putText(out, "NO HAND DETECTED — PREDICTION SKIPPED",
                (8, banner_h - 6),
                cv2.FONT_HERSHEY_SIMPLEX, scale, (240, 240, 255), 1, cv2.LINE_AA)
    return out


def _burn_right_prediction(bgr: np.ndarray,
                            label: str, conf: float) -> np.ndarray:
    """
    Burn 'Right Prediction: X  Y%' into the bottom-left corner of any frame.
    Uses a dark pill background so it stays readable on any content.
    """
    h, w  = bgr.shape[:2]
    text  = f"Right Prediction: {label}  {conf:.1f}%"
    scale = max(0.40, h / 800)
    thick = 1
    (tw, th), bl = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, thick)
    y0 = h - 8
    cv2.rectangle(bgr, (4, y0 - th - bl - 4), (4 + tw + 8, y0 + 2),
                  (0, 0, 0), -1)
    cv2.putText(bgr, text, (8, y0 - bl),
                cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 230, 160), thick, cv2.LINE_AA)
    return bgr


# ──────────────────────────────────────────────────────────────────────────────
# Pipeline comparison
# ──────────────────────────────────────────────────────────────────────────────

def _print_pipeline_comparison(hand_crop_active: bool) -> None:
    crop_status = "ACTIVE" if hand_crop_active else "DISABLED (mediapipe missing)"
    print(f"""
{'═' * 72}
  Pipeline comparison
{'═' * 72}
  PREVIOUS (before this change)
  ─────────────────────────────────────────────────────────────────────
  extract_clips()
    └─ frames_to_tensor (resize 224 only)
         └─ model → predict
  viz: full original frame  ← Grad-CAM MISALIGNED (computed on resize,
                               drawn on full frame)

  CURRENT  [hand crop: {crop_status}]
  ─────────────────────────────────────────────────────────────────────
  extract_clips()
    └─ preprocess_clip_frames()   ← MediaPipe HandLandmarker
         • hand bbox + {HAND_PADDING} px padding  (matches training data)
         • +5% bbox expansion     (extra inference context)
         • fallback: square center-crop if no hand detected
         └─ frames_to_tensor (resize 224 + normalize)
              └─ model → predict
  viz: cropped frame (= model input) ← Grad-CAM ALIGNED with hand
{'═' * 72}
""")


# ──────────────────────────────────────────────────────────────────────────────
# CLI entry point
# ──────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="JuanSign — video analysis pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  python analyze_video.py --source demo.mp4
  python analyze_video.py --source demo.mp4 --overlay-only
  python analyze_video.py --source demo.mp4 --pdf report.pdf
  python analyze_video.py --source demo.mp4 --output custom_out.mp4 --fps 15
""",
    )
    parser.add_argument("--source", required=True,
                        help="Path to input video file")
    parser.add_argument(
        "--model",
        default=os.path.join(_ML_DIR, "juansignmodel", "juansign_model.pth"),
        help="Path to model weights .pth (default: juansignmodel/juansign_model.pth)",
    )
    parser.add_argument("--output", default=None,
                        help="Output video path "
                             "(default: <source>_analyzed.mp4 or <source>_overlay.mp4)")
    parser.add_argument("--overlay-only", action="store_true",
                        help="Skip panel layout; burn Grad-CAM + label directly onto "
                             "the original frames (output keeps source resolution)")
    parser.add_argument("--pdf", default=None,
                        help="Export per-clip summary PDF to this path")
    parser.add_argument("--fps", type=float, default=None,
                        help="Override output FPS (default: same as source)")
    args = parser.parse_args()

    # ── Validate inputs ────────────────────────────────────────────────────────
    if not os.path.isfile(args.source):
        print(f"ERROR: source not found: {args.source}")
        sys.exit(1)
    if not os.path.isfile(args.model):
        print(f"ERROR: model weights not found: {args.model}")
        sys.exit(1)

    # ── Output path ────────────────────────────────────────────────────────────
    if args.output:
        out_path = args.output
    else:
        src    = Path(args.source)
        suffix = "_overlay" if args.overlay_only else "_analyzed"
        out_path = str(src.with_name(src.stem + suffix + ".mp4"))

    # ── Device + model ─────────────────────────────────────────────────────────
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    print(f"Device       : {device}")
    print(f"Source       : {args.source}")
    print(f"Model        : {args.model}")
    print(f"Output       : {out_path}")
    print(f"Mode         : {'overlay-only' if args.overlay_only else 'panel'}")
    if args.pdf:
        print(f"PDF          : {args.pdf}")
    print()

    model         = load_model(args.model, len(CLASS_NAMES), device)
    feat_cap      = ResNetFeatureCapture(model)
    lstm_cap      = LSTMFullStateCapture(model)
    gradcam_fn    = GradCAM(model)
    hand_detector = _build_hand_detector()

    if hand_detector is None:
        print("Hand crop    : DISABLED (mediapipe not available — full-frame resize)")
    else:
        print("Hand crop    : enabled  (MediaPipe HandLandmarker, matches training pipeline)")

    # ── Extract clips ──────────────────────────────────────────────────────────
    print("Extracting clips …")
    clips = extract_clips(args.source, NUM_FRAMES)
    if not clips:
        print("ERROR: no complete 16-frame clips found (video too short?).")
        sys.exit(1)

    total_clips = len(clips)
    print(f"Found {total_clips} clips × {NUM_FRAMES} frames "
          f"= {total_clips * NUM_FRAMES} frames total\n")

    # ── Source video metadata ──────────────────────────────────────────────────
    cap_meta = cv2.VideoCapture(args.source)
    src_fps  = cap_meta.get(cv2.CAP_PROP_FPS) or 30.0
    src_w    = int(cap_meta.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h    = int(cap_meta.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap_meta.release()

    out_fps      = args.fps or src_fps
    # Overlay mode outputs the hand-crop view at CROP_DISPLAY × CROP_DISPLAY
    # (crops are roughly square; stretching to the original src resolution would
    # distort the Grad-CAM overlay).  Panel mode keeps the full 960 × 544 canvas.
    out_w, out_h = (CROP_DISPLAY, CROP_DISPLAY) if args.overlay_only else (CANVAS_W, CANVAS_H)

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(out_path, fourcc, out_fps, (out_w, out_h))

    # ── Pass 1: analyse all clips ──────────────────────────────────────────────
    print("Analysing clips …")
    all_results: List[ClipResult]        = []
    history:     List[Tuple[str, float]] = []   # (label, confidence) per clip

    for clip_idx, clip_frames in enumerate(clips):
        print(f"  Clip {clip_idx + 1:3d}/{total_clips}  … ", end="", flush=True)

        result = analyze_clip(
            model, clip_frames, CLASS_NAMES,
            feat_cap, lstm_cap, gradcam_fn,
            device, clip_idx,
            hand_detector=hand_detector,
        )
        all_results.append(result)
        history.append((result.label, result.confidence))

        if result.is_valid:
            print(f"→  {result.label}  ({result.confidence:.1f}%)")
        else:
            print("→  [no hand detected — skipped]")

    # ── Right Prediction: highest-confidence valid clip ────────────────────────
    valid_results = [r for r in all_results if r.is_valid]
    if valid_results:
        right = max(valid_results, key=lambda r: r.confidence)
        right_label, right_conf = right.label, right.confidence
        print(f"\nRight Prediction : {right_label}  "
              f"({right_conf:.1f}%  —  Clip {right.clip_idx + 1})")
    else:
        right_label, right_conf = "—", 0.0
        print("\nRight Prediction : — (no clip with a detected hand)")

    # ── Pass 2: render output video ────────────────────────────────────────────
    print("\nRendering output video …")
    for result in all_results:
        # Rebuild cumulative history up to this clip for the timeline strip
        clip_history = history[: result.clip_idx + 1]

        # Render using the cropped frames so Grad-CAM overlays align with
        # exactly what the model saw.
        for fi, frame_bgr in enumerate(result.raw_frames):
            if not result.is_valid:
                # ── Skipped clip: cross-out ────────────────────────────────────
                if args.overlay_only:
                    composed = _cross_out(cv2.resize(frame_bgr, (out_w, out_h)))
                else:
                    composed = compose_panel_frame(
                        frame_bgr, result, fi, clip_history, total_clips)
                    composed = _add_no_hand_banner(composed)
            else:
                # ── Valid clip: normal render ──────────────────────────────────
                if args.overlay_only:
                    composed = render_overlay_frame(
                        frame_bgr, result.cam, result.label, result.confidence)
                else:
                    composed = compose_panel_frame(
                        frame_bgr, result, fi, clip_history, total_clips)

            # Burn Right Prediction into every frame
            _burn_right_prediction(composed, right_label, right_conf)

            # Guard against rounding mismatches
            if composed.shape[1] != out_w or composed.shape[0] != out_h:
                composed = cv2.resize(composed, (out_w, out_h))

            writer.write(composed)

    writer.release()
    print(f"\nOutput video saved → {out_path}")

    # ── Optional PDF ───────────────────────────────────────────────────────────
    if args.pdf:
        export_pdf(all_results, args.pdf)

    # ── Cleanup hooks ──────────────────────────────────────────────────────────
    feat_cap.remove()
    lstm_cap.remove()
    gradcam_fn.remove_hooks()
    if hand_detector is not None:
        hand_detector.close()
    print("\nDone.")
    _print_pipeline_comparison(hand_detector is not None)


if __name__ == "__main__":
    main()
