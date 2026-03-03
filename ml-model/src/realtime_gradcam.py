"""
realtime_gradcam.py
-------------------
Real-time FSL sign recognition with live Grad-CAM overlay.

Accumulates a 16-frame rolling webcam buffer, then runs the trained
ResNetLSTM model + Grad-CAM in a background thread every
INFERENCE_INTERVAL seconds.

Display window — two panels side-by-side:
  Left   Live webcam feed with predicted sign and confidence
  Right  Grad-CAM heatmap overlay on the last inference snapshot,
         plus a per-class softmax probability bar chart

Controls
--------
  q  quit
  r  reset the frame buffer (re-collect 16 frames from scratch)
  s  save the current display window to a PNG file

Run from ml-model/src/
    python realtime_gradcam.py
"""

import os
import sys
import time
import threading
import collections

import cv2
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from torchvision import transforms

from resnet_lstm_architecture import ResNetLSTM
from gradcam import GradCAM


# ── Configuration ─────────────────────────────────────────────────────────────
MODEL_PATH         = "./juansignmodel/juansign_model.pth"
CLASS_NAMES        = ["A", "B", "C", "J", "O"]  # alphabetical — must match training
NUM_FRAMES         = 16                          # clip length the model expects
IMG_SIZE           = 224                         # spatial resolution
CAMERA_INDEX       = 0                           # webcam device index (try 1 if 0 fails)
PANEL_SIZE         = 480                         # pixel side-length of each display panel
INFERENCE_INTERVAL = 0.5                         # seconds between inference runs
GRADCAM_ALPHA      = 0.45                        # heatmap blend weight (0=original, 1=heatmap)
SAVE_DIR           = "../realtime_captures"      # folder for 's' key saves


# ── Device (device-agnostic pattern — architectural_patterns.md §1) ───────────
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")


# ── Inference transform (identical to predict_sign.py, fsl_dataset.py eval) ──
_transform = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])


# ── OpenCV drawing helpers ────────────────────────────────────────────────────
# Colours in BGR
_C = {
    "green"  : (60,  210,  60),
    "yellow" : (0,   200, 240),
    "white"  : (240, 240, 240),
    "gray"   : (120, 120, 120),
    "dark"   : (18,   18,  28),
    "bg_bar" : (55,   55,  65),
    "red"    : (60,   60, 220),
    "blue"   : (180, 120,  80),
}
_FONT = cv2.FONT_HERSHEY_DUPLEX


def _text(img, text, pos, scale=0.65, color=None, thickness=1):
    color = color or _C["white"]
    cv2.putText(img, text, pos, _FONT, scale, color, thickness, cv2.LINE_AA)


# ── Inference worker (background thread) ─────────────────────────────────────
class InferenceWorker:
    """
    Maintains a rolling 16-frame buffer and runs model inference + Grad-CAM
    in a daemon thread.

    Two forward passes per inference cycle:
      1. torch.no_grad()  — fast probabilities + predicted class index
      2. gradcam.compute() — backward pass for the spatial heatmap

    Both passes target the same class index so they are consistent.
    """

    def __init__(self, model):
        self.model   = model
        self.gradcam = GradCAM(model)   # registers hooks on feature_extractor[7]

        self._buf      = collections.deque(maxlen=NUM_FRAMES)
        self._buf_lock = threading.Lock()

        # Shared result dict — written by inference thread, read by main thread
        self._result = {
            "ready"     : False,
            "label"     : "—",
            "confidence": 0.0,
            "probs"     : np.zeros(len(CLASS_NAMES), dtype=np.float32),
            "overlay"   : None,   # BGR uint8 [PANEL_SIZE, PANEL_SIZE, 3]
        }
        self._res_lock = threading.Lock()

        self._stop = threading.Event()
        threading.Thread(target=self._loop, daemon=True).start()

    # ── Public API ────────────────────────────────────────────────────────────

    def push(self, bgr_frame):
        """Add one BGR webcam frame to the rolling buffer."""
        with self._buf_lock:
            self._buf.append(bgr_frame.copy())

    def result(self):
        """Return a shallow copy of the latest result (thread-safe)."""
        with self._res_lock:
            return dict(self._result)

    def buf_fill(self):
        with self._buf_lock:
            return len(self._buf)

    def reset(self):
        """Discard all buffered frames — display will show 'Buffering' again."""
        with self._buf_lock:
            self._buf.clear()

    def stop(self):
        self._stop.set()
        self.gradcam.remove_hooks()

    # ── Thread body ───────────────────────────────────────────────────────────

    def _loop(self):
        while not self._stop.is_set():
            with self._buf_lock:
                full   = len(self._buf) >= NUM_FRAMES
                frames = list(self._buf) if full else None

            if not full:
                time.sleep(0.05)
                continue

            try:
                label, conf, probs, overlay = self._infer(frames)
                with self._res_lock:
                    self._result.update(
                        ready=True,
                        label=label,
                        confidence=conf,
                        probs=probs,
                        overlay=overlay,
                    )
            except Exception as exc:
                print(f"[InferenceWorker] {exc}", file=sys.stderr)

            # Throttle — avoid hammering the GPU/CPU continuously
            time.sleep(INFERENCE_INTERVAL)

    def _infer(self, frames):
        """
        Build clip tensor, run two forward passes, return display-ready results.
        """
        # Convert BGR webcam frames → normalised tensors
        tensors = []
        for bgr in frames:
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            tensors.append(_transform(Image.fromarray(rgb)))
        clip = torch.stack(tensors).unsqueeze(0).to(device)   # [1, 16, 3, 224, 224]

        # ── Pass 1: fast prediction + probabilities (no gradient) ────────────
        # Follows Inference Guard pattern (architectural_patterns.md §3):
        # model.eval() was already set at load time; we add torch.no_grad() here.
        with torch.no_grad():
            probs_t = F.softmax(self.model(clip), dim=1)[0].cpu()
        probs     = probs_t.numpy()
        class_idx = int(probs_t.argmax())
        label     = CLASS_NAMES[class_idx]
        conf      = float(probs[class_idx]) * 100

        # ── Pass 2: Grad-CAM heatmap (gradient pass, same class target) ──────
        # GradCAM.compute() calls model.eval() internally and runs forward +
        # backward.  The activation/gradient hooks on feature_extractor[7] are
        # overwritten by this second pass, so they reflect the gradient-enabled
        # computation graph — which is what Grad-CAM needs.
        cam, _ = self.gradcam.compute(clip, class_idx=class_idx)

        # Overlay heatmap on the last frame of the clip
        snapshot  = cv2.resize(frames[-1], (IMG_SIZE, IMG_SIZE))
        hm        = np.uint8(255 * cv2.resize(cam, (IMG_SIZE, IMG_SIZE)))
        hm_bgr    = cv2.applyColorMap(hm, cv2.COLORMAP_JET)
        overlay   = cv2.addWeighted(snapshot, 1 - GRADCAM_ALPHA, hm_bgr, GRADCAM_ALPHA, 0)
        overlay   = cv2.resize(overlay, (PANEL_SIZE, PANEL_SIZE))

        return label, conf, probs, overlay


# ── Panel builders ────────────────────────────────────────────────────────────

def _live_panel(frame, result, buf_fill):
    """
    Left panel: raw webcam frame with a translucent footer showing the
    current prediction or a buffering progress bar.
    """
    panel = cv2.resize(frame, (PANEL_SIZE, PANEL_SIZE))

    # Translucent dark strip at the bottom (footer)
    footer = panel.copy()
    cv2.rectangle(footer, (0, PANEL_SIZE - 88), (PANEL_SIZE, PANEL_SIZE), _C["dark"], -1)
    cv2.addWeighted(footer, 0.65, panel, 0.35, 0, panel)

    if result["ready"]:
        conf  = result["confidence"]
        color = _C["green"] if conf >= 60 else _C["yellow"]
        _text(panel, f"Sign: {result['label']}",
              (12, PANEL_SIZE - 52), scale=1.3, color=color, thickness=2)
        _text(panel, f"Confidence: {conf:.1f}%",
              (12, PANEL_SIZE - 15), scale=0.65, color=_C["white"])
    else:
        pct = buf_fill / NUM_FRAMES
        _text(panel, f"Buffering  {buf_fill} / {NUM_FRAMES}",
              (12, PANEL_SIZE - 58), scale=0.75, color=_C["yellow"])
        bx0, bx1 = 12, PANEL_SIZE - 12
        by0, by1 = PANEL_SIZE - 36, PANEL_SIZE - 16
        cv2.rectangle(panel, (bx0, by0), (bx1, by1), _C["bg_bar"], -1)
        filled = bx0 + max(0, int((bx1 - bx0) * pct))
        if filled > bx0:
            cv2.rectangle(panel, (bx0, by0), (filled, by1), _C["green"], -1)

    # Small LIVE badge
    _text(panel, "LIVE", (PANEL_SIZE - 64, 27), scale=0.6, color=_C["red"], thickness=2)
    return panel


def _gradcam_panel(result):
    """
    Right panel: Grad-CAM heatmap overlay with a header and a probability
    bar chart strip along the bottom.
    """
    if result["overlay"] is None:
        panel = np.full((PANEL_SIZE, PANEL_SIZE, 3), 18, dtype=np.uint8)
        _text(panel, "Waiting for first inference...",
              (16, PANEL_SIZE // 2), color=_C["gray"])
        return panel

    panel = result["overlay"].copy()

    # ── Header ────────────────────────────────────────────────────────────────
    hdr = panel.copy()
    cv2.rectangle(hdr, (0, 0), (PANEL_SIZE, 34), _C["dark"], -1)
    cv2.addWeighted(hdr, 0.72, panel, 0.28, 0, panel)
    _text(panel, "Grad-CAM  (ResNet18 layer4)", (8, 23), scale=0.6)

    # ── Probability bar chart ──────────────────────────────────────────────────
    n        = len(CLASS_NAMES)
    bar_h    = 15
    gap      = 5
    pad      = 8
    strip_h  = n * (bar_h + gap) + pad * 2
    label_w  = 46            # left margin reserved for class label
    pct_w    = 38            # right margin reserved for "xx%" text
    bar_area = PANEL_SIZE - label_w - pct_w

    ftr = panel.copy()
    cv2.rectangle(ftr, (0, PANEL_SIZE - strip_h), (PANEL_SIZE, PANEL_SIZE), _C["dark"], -1)
    cv2.addWeighted(ftr, 0.72, panel, 0.28, 0, panel)

    probs = result["probs"]
    pred  = result["label"]
    for i, (cls, prob) in enumerate(zip(CLASS_NAMES, probs)):
        y0  = PANEL_SIZE - strip_h + pad + i * (bar_h + gap)
        y1  = y0 + bar_h
        col = _C["green"] if cls == pred else _C["blue"]
        w   = max(2, int(bar_area * prob))
        x0  = label_w
        cv2.rectangle(panel, (x0, y0), (x0 + bar_area, y1), _C["bg_bar"], -1)
        cv2.rectangle(panel, (x0, y0), (x0 + w,        y1), col, -1)
        _text(panel, cls,                  (6,            y1 - 2), scale=0.5)
        _text(panel, f"{prob * 100:.0f}%", (x0 + bar_area + 4, y1 - 2), scale=0.45)

    return panel


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    # ── Validate model path ───────────────────────────────────────────────────
    if not os.path.isfile(MODEL_PATH):
        print(f"Error: model not found at '{MODEL_PATH}'")
        print("  Train the model first: python train.py")
        sys.exit(1)

    print(f"Device : {device}")

    # ── Load model (Model Load Pattern — architectural_patterns.md §2) ────────
    model = ResNetLSTM(num_classes=len(CLASS_NAMES)).to(device)
    model.load_state_dict(torch.load(MODEL_PATH, map_location=device))
    model.eval()
    print("Model  : loaded")

    # ── Open webcam ───────────────────────────────────────────────────────────
    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        print(f"Error: cannot open camera index {CAMERA_INDEX}")
        print("  Set CAMERA_INDEX to the correct device number.")
        sys.exit(1)
    print(f"Camera : index {CAMERA_INDEX} opened")
    print("\nControls: [q] quit   [r] reset buffer   [s] save frame\n")

    # ── Prepare save directory ────────────────────────────────────────────────
    os.makedirs(SAVE_DIR, exist_ok=True)

    # ── Start inference worker ────────────────────────────────────────────────
    worker = InferenceWorker(model)

    save_n  = 0
    fps_t   = time.time()
    fps_cnt = 0
    fps_val = 0.0

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                print("Warning: failed to grab frame — retrying...")
                time.sleep(0.05)
                continue

            worker.push(frame)
            res = worker.result()

            # Build display
            left  = _live_panel(frame, res, worker.buf_fill())
            right = _gradcam_panel(res)
            sep   = np.full((PANEL_SIZE, 4, 3), 40, dtype=np.uint8)
            row   = np.hstack([left, sep, right])

            # FPS counter (updated every second)
            fps_cnt += 1
            now = time.time()
            if now - fps_t >= 1.0:
                fps_val = fps_cnt / (now - fps_t)
                fps_cnt = 0
                fps_t   = now

            # Title bar
            hdr = np.full((34, row.shape[1], 3), 12, dtype=np.uint8)
            _text(hdr,
                  "JuanSign — Real-Time FSL Recognition  |  ResNetLSTM + Grad-CAM",
                  (10, 23), scale=0.62, color=(160, 160, 160))
            _text(hdr, f"FPS {fps_val:.0f}",
                  (row.shape[1] - 78, 23), scale=0.55, color=_C["gray"])
            display = np.vstack([hdr, row])

            cv2.imshow("JuanSign Real-Time", display)

            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            elif key == ord("r"):
                worker.reset()
                print("Buffer reset — re-collecting frames.")
            elif key == ord("s"):
                path = os.path.join(SAVE_DIR, f"capture_{save_n:04d}.png")
                cv2.imwrite(path, display)
                print(f"Saved → {path}")
                save_n += 1

    finally:
        worker.stop()
        cap.release()
        cv2.destroyAllWindows()
        print("Stopped.")


if __name__ == "__main__":
    main()
