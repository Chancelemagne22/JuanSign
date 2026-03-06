"""
JuanSign — Real-time inference
==============================
Buffers webcam / video frames into a 16-frame sliding window and runs the
CNN-ResNet-LSTM model continuously, overlaying results on the live display.

Usage
-----
    # Webcam (default)
    python realtime_inference.py

    # Video file, record output, save log to custom path
    python realtime_inference.py --source clip.mp4 --record --log run1.csv

    # Slower machine: increase stride so inference runs less often
    python realtime_inference.py --stride 16

Controls
--------
    q   quit
    g   toggle Grad-CAM overlay on the current frame
"""

import argparse
import csv
import os
import sys
from collections import deque
from datetime import datetime

import cv2
import numpy as np
import torch
from PIL import Image
from torchvision import transforms

# ── resolve sibling modules (resnet_lstm_architecture, gradcam) ──────────────
_SRC_DIR = os.path.dirname(os.path.abspath(__file__))
_ML_DIR  = os.path.abspath(os.path.join(_SRC_DIR, ".."))
sys.path.insert(0, _SRC_DIR)

from resnet_lstm_architecture import ResNetLSTM  # noqa: E402
from gradcam import GradCAM                      # noqa: E402

# ── constants — MUST match training / predict_sign.py ────────────────────────
NUM_FRAMES  = 16
IMG_SIZE    = 224
MEAN        = [0.485, 0.456, 0.406]
STD         = [0.229, 0.224, 0.225]
CLASS_NAMES = [
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
    "N", "N~", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
]

_TRANSFORM = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(mean=MEAN, std=STD),
])

# ─────────────────────────────────────────────────────────────────────────────
# LSTM hidden-state capture hook
# ─────────────────────────────────────────────────────────────────────────────

class LSTMStateCapture:
    """
    Attaches a forward hook to model.lstm.
    After every forward pass, h_norms holds ||h_t|| for each of the T timesteps.
    Works whether the forward runs inside torch.no_grad() or with gradients.
    """

    def __init__(self, model: ResNetLSTM):
        self.h_norms: np.ndarray = np.zeros(NUM_FRAMES, dtype=np.float32)
        self._hook = model.lstm.register_forward_hook(self._capture)

    def _capture(self, module, input, output):
        # nn.LSTM returns (seq_out, (h_n, c_n))
        # seq_out: [B, T, hidden_size]
        seq_out, _ = output
        norms = seq_out[0].norm(dim=-1).detach().cpu().numpy()  # [T]
        self.h_norms = norms

    def remove(self):
        self._hook.remove()


# ─────────────────────────────────────────────────────────────────────────────
# Core helpers
# ─────────────────────────────────────────────────────────────────────────────

def load_model(model_path: str, num_classes: int,
               device: torch.device) -> ResNetLSTM:
    m = ResNetLSTM(num_classes=num_classes).to(device)
    m.load_state_dict(torch.load(model_path, map_location=device,
                                 weights_only=True))
    m.eval()
    return m


def frames_to_tensor(frames: list, device: torch.device) -> torch.Tensor:
    """List of 16 BGR ndarrays → [1, 16, 3, 224, 224] float tensor."""
    tensors = []
    for bgr in frames:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        pil = Image.fromarray(rgb)
        tensors.append(_TRANSFORM(pil))
    return torch.stack(tensors).unsqueeze(0).to(device)


def predict(model: ResNetLSTM, clip: torch.Tensor,
            class_names: list) -> tuple[str, float, int]:
    """
    Run a no-grad forward pass.
    Returns (label, confidence_pct, class_index).
    The LSTMStateCapture hook fires here and updates h_norms as a side effect.
    """
    with torch.no_grad():
        out   = model(clip)
        probs = torch.softmax(out, dim=1)
        conf, idx = probs.max(dim=1)
    return class_names[idx.item()], conf.item() * 100.0, idx.item()


# ─────────────────────────────────────────────────────────────────────────────
# Rendering helpers
# ─────────────────────────────────────────────────────────────────────────────

def draw_hud(frame: np.ndarray, label: str, conf: float,
             gradcam_on: bool, buf_len: int) -> np.ndarray:
    """Prediction label + buffer fill indicator in the top-left corner."""
    out = frame.copy()
    # semi-transparent black background strip
    overlay = out.copy()
    cv2.rectangle(overlay, (0, 0), (340, 72), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.55, out, 0.45, 0, out)

    cv2.putText(out, f"{label}  {conf:.1f}%", (10, 34),
                cv2.FONT_HERSHEY_SIMPLEX, 1.1, (0, 255, 80), 2, cv2.LINE_AA)

    status = f"buf {buf_len:02d}/{NUM_FRAMES}"
    if gradcam_on:
        status += "  [Grad-CAM]"
    cv2.putText(out, status, (10, 58),
                cv2.FONT_HERSHEY_SIMPLEX, 0.46, (180, 180, 180), 1,
                cv2.LINE_AA)
    return out


def draw_lstm_bar(frame: np.ndarray, h_norms: np.ndarray,
                  bar_height: int = 22) -> np.ndarray:
    """
    Horizontal heatmap strip at the bottom of the frame.
    Each cell corresponds to one LSTM timestep; colour encodes ||h_t||.
    """
    H, W = frame.shape[:2]
    T    = len(h_norms)

    # Normalise to [0, 255]
    vmax  = h_norms.max()
    norm  = (h_norms / (vmax + 1e-8) * 255).astype(np.uint8)

    # Build 1×T strip, resize to W×bar_height, apply colormap
    strip        = norm.reshape(1, T)
    strip_scaled = cv2.resize(strip, (W, bar_height),
                              interpolation=cv2.INTER_LINEAR)
    bar_bgr      = cv2.applyColorMap(strip_scaled, cv2.COLORMAP_PLASMA)

    out = frame.copy()
    out[H - bar_height:H, :] = bar_bgr
    cv2.putText(out, "LSTM h_t", (4, H - bar_height + 15),
                cv2.FONT_HERSHEY_SIMPLEX, 0.36, (255, 255, 255), 1,
                cv2.LINE_AA)
    return out


def blend_gradcam(frame_bgr: np.ndarray, cam: np.ndarray,
                  alpha: float = 0.45) -> np.ndarray:
    """
    Resize cam (float32 [0,1], spatial size 7×7 from layer4) to frame size,
    apply Jet colormap, and addWeighted-blend onto the frame.
    """
    h, w   = frame_bgr.shape[:2]
    hmap   = cv2.resize(cam, (w, h), interpolation=cv2.INTER_LINEAR)
    hmap8  = np.uint8(255 * hmap)
    color  = cv2.applyColorMap(hmap8, cv2.COLORMAP_JET)
    return cv2.addWeighted(frame_bgr, 1 - alpha, color, alpha, 0)


# ─────────────────────────────────────────────────────────────────────────────
# Main loop
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="JuanSign — real-time sign language inference")
    parser.add_argument(
        "--model", default=os.path.join(
            _ML_DIR, "juansignmodel", "juansign_model.pth"),
        help="Path to model weights (.pth)")
    parser.add_argument(
        "--source", default="0",
        help="Webcam index (e.g. 0) or path to a video file")
    parser.add_argument(
        "--stride", type=int, default=8,
        help="Run inference every N new frames in the sliding window "
             "(default: 8 ≈ 2 inferences/sec at 30 fps)")
    parser.add_argument(
        "--record", action="store_true",
        help="Save the annotated output stream to output.mp4")
    parser.add_argument(
        "--log", default="session_log.csv",
        help="CSV session log path (default: session_log.csv)")
    args = parser.parse_args()

    # coerce source to int if it looks like a camera index
    try:
        source = int(args.source)
    except ValueError:
        source = args.source

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device  : {device}")
    print(f"Model   : {args.model}")
    print(f"Source  : {source}")
    print(f"Stride  : every {args.stride} frames")
    print("Controls: [q] quit  |  [g] toggle Grad-CAM")
    print()

    # ── model + hooks ─────────────────────────────────────────────────────────
    model      = load_model(args.model, len(CLASS_NAMES), device)
    lstm_cap   = LSTMStateCapture(model)
    gradcam_fn = GradCAM(model)          # attaches hooks to feature_extractor[7]

    # ── video capture ─────────────────────────────────────────────────────────
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        print(f"ERROR: cannot open source '{source}'")
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    W   = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H   = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"Stream  : {W}×{H} @ {fps:.1f} fps")

    # ── optional recorder ─────────────────────────────────────────────────────
    recorder = None
    if args.record:
        fourcc   = cv2.VideoWriter_fourcc(*"mp4v")
        recorder = cv2.VideoWriter("output.mp4", fourcc, fps, (W, H))
        print("Recording → output.mp4")

    # ── CSV session log ───────────────────────────────────────────────────────
    log_fh  = open(args.log, "w", newline="", encoding="utf-8")
    log_csv = csv.writer(log_fh)
    log_csv.writerow(["timestamp", "predicted_class", "confidence", "mode"])

    # ── mutable live state ────────────────────────────────────────────────────
    buf          = deque(maxlen=NUM_FRAMES)   # ring buffer of raw BGR frames
    frames_since = 0                           # frames added since last inference
    pred_label   = "—"
    pred_conf    = 0.0
    h_norms      = np.zeros(NUM_FRAMES, dtype=np.float32)
    gradcam_on   = False
    cam_map      = None                        # last computed Grad-CAM float array

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            buf.append(frame.copy())
            frames_since += 1
            display = frame.copy()

            # ── inference block ───────────────────────────────────────────────
            if len(buf) == NUM_FRAMES and frames_since >= args.stride:
                frames_since = 0
                clip = frames_to_tensor(list(buf), device)

                # Always run a clean no-grad pass — captures h_norms via hook
                pred_label, pred_conf, pred_idx = predict(
                    model, clip, CLASS_NAMES)
                # Copy norms before a potential Grad-CAM pass overwrites them
                h_norms = lstm_cap.h_norms.copy()

                if gradcam_on:
                    # GradCAM needs a separate gradient-enabled forward+backward.
                    # We pass class_idx so it targets the already-predicted class.
                    cam_map, _ = gradcam_fn.compute(clip, class_idx=pred_idx)
                    mode = "gradcam"
                else:
                    cam_map = None
                    mode    = "normal"

                log_csv.writerow([
                    datetime.now().isoformat(timespec="milliseconds"),
                    pred_label,
                    f"{pred_conf:.2f}",
                    mode,
                ])
                log_fh.flush()

            # ── compositing ───────────────────────────────────────────────────
            if gradcam_on and cam_map is not None:
                display = blend_gradcam(display, cam_map)
            display = draw_hud(display, pred_label, pred_conf,
                               gradcam_on, len(buf))
            display = draw_lstm_bar(display, h_norms)

            if recorder:
                recorder.write(display)

            cv2.imshow("JuanSign — Real-Time Inference", display)
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            elif key == ord("g"):
                gradcam_on = not gradcam_on
                cam_map    = None   # clear stale heatmap when toggling off
                print(f"Grad-CAM {'ON' if gradcam_on else 'OFF'}")

    finally:
        cap.release()
        if recorder:
            recorder.release()
        cv2.destroyAllWindows()
        log_fh.close()
        lstm_cap.remove()
        gradcam_fn.remove_hooks()
        print(f"\nSession log saved → {args.log}")


if __name__ == "__main__":
    main()
