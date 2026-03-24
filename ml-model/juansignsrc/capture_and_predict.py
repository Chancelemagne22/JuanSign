"""
capture_and_predict.py — Webcam capture + local inference for JuanSign.

Controls:
    SPACE  → start recording
    ENTER  → stop recording and run prediction
    Q      → quit

Usage (run from juansignsrc/):
    python capture_and_predict.py
"""

import os
import sys
import tempfile
import time

import cv2
import matplotlib.pyplot as plt
import numpy as np
import torch
import torch.nn as nn
from torchvision import models

from resnet_lstm_architecture import ResNetLSTM

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

MODEL_PATH      = "./juansignmodel/juansign_model.pth"
HAND_MODEL_PATH = "./hand_landmarker.task"
FACE_MODEL_PATH = "./blaze_face_short_range.tflite"

# Optional: set to the sign you're attempting so correctness is shown
TARGET_SIGN  = ""

# Webcam index (0 = default camera)
CAMERA_INDEX = 0
OUTPUT_FPS   = 20

# ══════════════════════════════════════════════════════════════════════════════
# CONSTANTS — must match train.py / frame_extractor.py
# ══════════════════════════════════════════════════════════════════════════════

TARGET_FRAMES        = 32
TARGET_SIZE          = 224
HAND_PADDING         = 60
FLOW_NORM_SCALE      = 30.0
LANDMARK_FEATURE     = 63
WINDOW_STRIDE        = 8
CONFIDENCE_THRESHOLD = 0.70
IMAGENET_MEAN        = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD         = np.array([0.229, 0.224, 0.225], dtype=np.float32)

KEY_SPACE = 32
KEY_ENTER = 13
KEY_Q     = ord("q")

# MediaPipe hand skeleton connections (landmark index pairs)
HAND_CONNECTIONS = [
    # Thumb
    (0,1),(1,2),(2,3),(3,4),
    # Index
    (0,5),(5,6),(6,7),(7,8),
    # Middle
    (0,9),(9,10),(10,11),(11,12),
    # Ring
    (0,13),(13,14),(14,15),(15,16),
    # Pinky
    (0,17),(17,18),(18,19),(19,20),
    # Palm
    (5,9),(9,13),(13,17),
]

# ══════════════════════════════════════════════════════════════════════════════
# MODEL LOADER
# ══════════════════════════════════════════════════════════════════════════════

def _load_model(device):
    checkpoint  = torch.load(MODEL_PATH, map_location=device, weights_only=False)
    class_names = checkpoint["class_names"]
    num_classes = checkpoint["num_classes"]

    model = ResNetLSTM(num_classes=num_classes).to(device)
    model.load_state_dict(checkpoint["model_state"])
    model.eval()

    print(f"[Model] Loaded — classes ({num_classes}): {class_names}")
    return model, class_names


# ══════════════════════════════════════════════════════════════════════════════
# MEDIAPIPE HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _build_mediapipe():
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision

    hand_opts = mp_vision.HandLandmarkerOptions(
        base_options = mp_python.BaseOptions(model_asset_path=HAND_MODEL_PATH),
        num_hands    = 1,
        min_hand_detection_confidence = 0.3,
        min_hand_presence_confidence  = 0.3,
        min_tracking_confidence       = 0.3,
    )
    hand_detector = mp_vision.HandLandmarker.create_from_options(hand_opts)

    face_opts = mp_vision.FaceDetectorOptions(
        base_options = mp_python.BaseOptions(model_asset_path=FACE_MODEL_PATH),
        min_detection_confidence = 0.4,
    )
    face_detector = mp_vision.FaceDetector.create_from_options(face_opts)

    return face_detector, hand_detector


def _anonymize_face(frame_bgr, face_detector):
    import mediapipe as mp
    h, w = frame_bgr.shape[:2]
    rgb  = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    result = face_detector.detect(
        mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    )
    for det in result.detections:
        bb = det.bounding_box
        x1, y1 = max(0, bb.origin_x), max(0, bb.origin_y)
        x2, y2 = min(w, bb.origin_x + bb.width), min(h, bb.origin_y + bb.height)
        if x2 > x1 and y2 > y1:
            frame_bgr[y1:y2, x1:x2] = cv2.GaussianBlur(
                frame_bgr[y1:y2, x1:x2], (51, 51), 0
            )
    return frame_bgr


def _hand_crop(frame_bgr, hand_detector):
    import mediapipe as mp
    h, w = frame_bgr.shape[:2]
    rgb  = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    result = hand_detector.detect(
        mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    )
    if not result.hand_landmarks:
        return None, np.zeros(LANDMARK_FEATURE, dtype=np.float32)

    xs, ys, coords = [], [], []
    for hand in result.hand_landmarks:
        for lm in hand:
            xs.append(int(lm.x * w))
            ys.append(int(lm.y * h))
            coords.extend([lm.x, lm.y, lm.z])

    x1 = max(0, min(xs) - HAND_PADDING)
    y1 = max(0, min(ys) - HAND_PADDING)
    x2 = min(w, max(xs) + HAND_PADDING)
    y2 = min(h, max(ys) + HAND_PADDING)

    if x2 <= x1 or y2 <= y1:
        return None, np.zeros(LANDMARK_FEATURE, dtype=np.float32)

    landmarks = np.array(coords[:LANDMARK_FEATURE], dtype=np.float32)
    return frame_bgr[y1:y2, x1:x2], landmarks


def _center_crop(frame_bgr):
    h, w = frame_bgr.shape[:2]
    side = min(h, w)
    return frame_bgr[(h-side)//2:(h+side)//2, (w-side)//2:(w+side)//2]


# ══════════════════════════════════════════════════════════════════════════════
# PREPROCESSING
# ══════════════════════════════════════════════════════════════════════════════

def _sample_indices(total, n=TARGET_FRAMES):
    if total <= 0:  return [0] * n
    if total <= n:  return list(range(total)) + [total - 1] * (n - total)
    return np.linspace(0, total - 1, n, dtype=int).tolist()


def _compute_optical_flow(frames_bgr):
    n          = len(frames_bgr)
    flow_array = np.zeros((n, 2, TARGET_SIZE, TARGET_SIZE), dtype=np.float32)
    grays      = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in frames_bgr]
    for i in range(1, n):
        flow = cv2.calcOpticalFlowFarneback(
            grays[i-1], grays[i], None,
            pyr_scale=0.5, levels=3, winsize=15,
            iterations=3, poly_n=5, poly_sigma=1.2, flags=0,
        )
        flow_array[i, 0] = flow[:, :, 0]
        flow_array[i, 1] = flow[:, :, 1]
    return flow_array


def _extract_frames(video_path, face_detector, hand_detector):
    """
    Read video → extract TARGET_FRAMES → build 5-channel tensor.
    Returns:
        frames_tensor    : [1, 32, 5, 224, 224]
        landmarks_tensor : [1, 32, 63]
        frames_bgr       : list of 32 uint8 BGR arrays [224, 224, 3]  (for display)
        landmarks_list   : list of 32 float32 arrays [63]             (for skeleton)
        debug_info       : dict
    """
    cap    = cv2.VideoCapture(video_path)
    total  = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    indices = _sample_indices(total)

    frames_bgr, landmarks_list, hand_count = [], [], 0

    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()

        if not ret:
            if frames_bgr:
                frames_bgr.append(frames_bgr[-1].copy())
                landmarks_list.append(landmarks_list[-1].copy())
            else:
                frames_bgr.append(np.zeros((TARGET_SIZE, TARGET_SIZE, 3), dtype=np.uint8))
                landmarks_list.append(np.zeros(LANDMARK_FEATURE, dtype=np.float32))
            continue

        frame           = _anonymize_face(frame, face_detector)
        cropped, lm     = _hand_crop(frame, hand_detector)

        if cropped is not None:
            hand_count += 1
            frame_bgr   = cv2.resize(cropped, (TARGET_SIZE, TARGET_SIZE),
                                     interpolation=cv2.INTER_AREA)
        else:
            frame_bgr   = cv2.resize(_center_crop(frame), (TARGET_SIZE, TARGET_SIZE),
                                     interpolation=cv2.INTER_AREA)

        frames_bgr.append(frame_bgr)
        landmarks_list.append(lm)

    cap.release()

    flow_array    = _compute_optical_flow(frames_bgr)
    frame_tensors = []

    for i, bgr in enumerate(frames_bgr):
        rgb   = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        rgb   = (rgb - IMAGENET_MEAN) / IMAGENET_STD
        rgb_t = torch.from_numpy(rgb).permute(2, 0, 1)                    # [3,H,W]

        flow_t = torch.from_numpy(flow_array[i]).float() / FLOW_NORM_SCALE
        flow_t = torch.clamp(flow_t, -1.0, 1.0)                           # [2,H,W]

        frame_tensors.append(torch.cat([rgb_t, flow_t], dim=0))           # [5,H,W]

    frames_tensor    = torch.stack(frame_tensors).unsqueeze(0).float()    # [1,32,5,224,224]
    landmarks_tensor = torch.from_numpy(
        np.stack(landmarks_list, axis=0)
    ).unsqueeze(0).float()                                                 # [1,32,63]

    debug_info = {
        "total_frames" : total,
        "hand_detected": hand_count,
        "hand_ratio"   : round(hand_count / TARGET_FRAMES, 2),
    }
    return frames_tensor, landmarks_tensor, frames_bgr, landmarks_list, debug_info


# ══════════════════════════════════════════════════════════════════════════════
# SLIDING WINDOW INFERENCE
# ══════════════════════════════════════════════════════════════════════════════

def _predict(model, frames_tensor, landmarks_tensor, device, class_names):
    T           = frames_tensor.shape[1]
    all_windows = []
    best_conf   = 0.0
    best_sign   = class_names[0]

    model.eval()
    with torch.no_grad():
        starts = list(range(0, max(1, T - TARGET_FRAMES + 1), WINDOW_STRIDE))
        if 0 not in starts:
            starts = [0] + starts

        for start in starts:
            end = start + TARGET_FRAMES
            if end > T:
                break

            w_frames    = frames_tensor[:, start:end].to(device)
            w_landmarks = landmarks_tensor[:, start:end].to(device)

            logits    = model(w_frames, w_landmarks)
            probs     = torch.softmax(logits, dim=1)[0]
            conf, idx = probs.max(dim=0)
            conf_val  = conf.item()
            sign_val  = class_names[idx.item()]

            all_windows.append({
                "start"     : start,
                "end"       : end,
                "sign"      : sign_val,
                "confidence": round(conf_val, 4),
            })

            if conf_val > best_conf and conf_val >= CONFIDENCE_THRESHOLD:
                best_conf = conf_val
                best_sign = sign_val

    if best_conf == 0.0 and all_windows:
        best = max(all_windows, key=lambda w: w["confidence"])
        best_sign, best_conf = best["sign"], best["confidence"]

    return best_sign, best_conf, all_windows


# ══════════════════════════════════════════════════════════════════════════════
# GRAD-CAM
# ══════════════════════════════════════════════════════════════════════════════

def _compute_gradcam(model, frames_tensor, landmarks_tensor, device, class_idx):
    """
    Run a single forward+backward pass to get Grad-CAM for layer4.
    Returns a float32 numpy array [H, W] normalised to [0, 1].
    Hooks are registered and removed within this call.
    """
    activations, gradients = {}, {}

    target_layer = model.visual_encoder.feature_extractor[7]
    fwd_hook = target_layer.register_forward_hook(
        lambda m, i, o: activations.update({"val": o})
    )
    bwd_hook = target_layer.register_full_backward_hook(
        lambda m, gi, go: gradients.update({"val": go[0]})
    )

    model.eval()
    frames    = frames_tensor.to(device)
    landmarks = landmarks_tensor.to(device)

    output = model(frames, landmarks)
    model.zero_grad()
    output[0, class_idx].backward()

    fwd_hook.remove()
    bwd_hook.remove()

    act  = activations["val"].detach()   # [T, 512, 7, 7]
    grad = gradients["val"].detach()     # [T, 512, 7, 7]

    weights = grad.mean(dim=(2, 3), keepdim=True)  # [T, 512, 1, 1]
    cam     = (weights * act).sum(dim=1).mean(dim=0)  # [7, 7]
    cam     = torch.relu(cam).cpu().numpy()

    if cam.max() > 0:
        cam = cam / cam.max()

    return cam


# ══════════════════════════════════════════════════════════════════════════════
# SKELETON
# ══════════════════════════════════════════════════════════════════════════════

def _draw_skeleton(frame_bgr, landmark_vec, dot_color=(0, 255, 0),
                   line_color=(255, 255, 255), dot_radius=4):
    """
    Draw hand landmark skeleton onto a copy of frame_bgr.
    landmark_vec : float32 [63] — 21 × (x_norm, y_norm, z_norm)
    Coordinates are normalised [0, 1]; scaled to frame size.
    """
    canvas = frame_bgr.copy()
    h, w   = canvas.shape[:2]

    # Parse normalised coords → pixel positions
    pts = []
    for i in range(21):
        x = int(landmark_vec[i * 3]     * w)
        y = int(landmark_vec[i * 3 + 1] * h)
        pts.append((x, y))

    # Draw connections
    for a, b in HAND_CONNECTIONS:
        cv2.line(canvas, pts[a], pts[b], line_color, 1, cv2.LINE_AA)

    # Draw landmark dots
    for pt in pts:
        cv2.circle(canvas, pt, dot_radius, dot_color, -1, cv2.LINE_AA)

    return canvas


# ══════════════════════════════════════════════════════════════════════════════
# RESULT VISUALISATION  (GradCAM + Skeleton)
# ══════════════════════════════════════════════════════════════════════════════

def _show_visualization(frames_bgr, landmarks_list, frames_tensor,
                        landmarks_tensor, model, device, class_idx,
                        sign, confidence):
    """
    Display a 4-panel figure:
        [Original]  [Skeleton]  [Grad-CAM]  [Overlay]
    Uses the middle frame (index 15) as the representative.
    """
    display_t = TARGET_FRAMES // 2   # frame 16

    # ── 1. Original frame (RGB for matplotlib) ─────────────────────────────
    orig_bgr = frames_bgr[display_t]
    orig_rgb = cv2.cvtColor(orig_bgr, cv2.COLOR_BGR2RGB)

    # ── 2. Skeleton on original ────────────────────────────────────────────
    lm_vec       = landmarks_list[display_t]
    has_landmark = lm_vec.any()
    skeleton_rgb = cv2.cvtColor(
        _draw_skeleton(orig_bgr, lm_vec) if has_landmark else orig_bgr.copy(),
        cv2.COLOR_BGR2RGB,
    )

    # ── 3. Grad-CAM ────────────────────────────────────────────────────────
    print("Computing Grad-CAM…")
    cam = _compute_gradcam(model, frames_tensor, landmarks_tensor, device, class_idx)
    cam_resized = cv2.resize(cam, (TARGET_SIZE, TARGET_SIZE))

    heatmap     = np.uint8(255 * cam_resized)
    heatmap_bgr = cv2.applyColorMap(heatmap, cv2.COLORMAP_JET)
    heatmap_rgb = cv2.cvtColor(heatmap_bgr, cv2.COLOR_BGR2RGB)

    # ── 4. Heatmap overlay on original ────────────────────────────────────
    overlay_bgr = cv2.addWeighted(orig_bgr, 0.5, heatmap_bgr, 0.5, 0)
    overlay_rgb = cv2.cvtColor(overlay_bgr, cv2.COLOR_BGR2RGB)

    # ── Plot ───────────────────────────────────────────────────────────────
    fig, axes = plt.subplots(1, 4, figsize=(18, 5))
    fig.suptitle(f"Predicted: {sign}  ({confidence:.1%} confidence)", fontsize=14)

    axes[0].imshow(orig_rgb);      axes[0].set_title("Original");         axes[0].axis("off")
    axes[1].imshow(skeleton_rgb);  axes[1].set_title("Hand Skeleton");     axes[1].axis("off")
    axes[2].imshow(heatmap_rgb);   axes[2].set_title("Grad-CAM (layer4)"); axes[2].axis("off")
    axes[3].imshow(overlay_rgb);   axes[3].set_title("GradCAM Overlay");   axes[3].axis("off")

    plt.tight_layout()
    plt.show()


# ══════════════════════════════════════════════════════════════════════════════
# WEBCAM CAPTURE
# ══════════════════════════════════════════════════════════════════════════════

def _draw_ui(frame, recording, frame_count):
    h, w = frame.shape[:2]
    if recording:
        cv2.rectangle(frame, (0, 0), (w - 1, h - 1), (0, 0, 220), 6)
        cv2.putText(frame, f"REC  {frame_count} frames",
                    (12, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 220), 2)
        cv2.putText(frame, "ENTER -> predict   Q -> quit",
                    (12, h - 16), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)
    else:
        cv2.putText(frame, "Ready",
                    (12, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 200, 0), 2)
        cv2.putText(frame, "SPACE -> record   Q -> quit",
                    (12, h - 16), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)


def capture() -> str | None:
    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        print(f"[Error] Cannot open camera {CAMERA_INDEX}")
        return None

    fw      = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    fh      = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    recording   = False
    writer      = None
    tmp_path    = None
    frame_count = 0

    print("Window open. Press SPACE to start recording.")

    while True:
        ret, frame = cap.read()
        if not ret:
            print("[Error] Camera read failed.")
            break

        _draw_ui(frame, recording, frame_count)

        if recording and writer is not None:
            writer.write(frame)
            frame_count += 1

        cv2.imshow("JuanSign — Local Inference", frame)
        key = cv2.waitKey(1) & 0xFF

        if key == KEY_Q:
            print("Quit.")
            break

        elif key == KEY_SPACE and not recording:
            tmp_fd, tmp_path = tempfile.mkstemp(suffix=".mp4")
            os.close(tmp_fd)
            fourcc  = cv2.VideoWriter_fourcc(*"mp4v")
            writer  = cv2.VideoWriter(tmp_path, fourcc, OUTPUT_FPS, (fw, fh))
            recording   = True
            frame_count = 0
            print(f"Recording… (press ENTER to predict)")

        elif key == KEY_ENTER and recording:
            recording = False
            if writer:
                writer.release()
                writer = None
            print(f"Stopped — {frame_count} frames.")
            break

    cap.release()
    cv2.destroyAllWindows()

    if frame_count == 0:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
        return None

    return tmp_path


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device : {device}")

    print("Loading model…")
    model, class_names = _load_model(device)

    print("Loading MediaPipe…")
    face_detector, hand_detector = _build_mediapipe()

    video_path = capture()

    if video_path is None:
        print("No video recorded. Exiting.")
        sys.exit(0)

    try:
        print("\nPreprocessing…")
        t0 = time.time()
        frames_tensor, landmarks_tensor, frames_bgr, landmarks_list, debug = _extract_frames(
            video_path, face_detector, hand_detector
        )
        print(f"  Hand ratio : {debug['hand_ratio']}  "
              f"({debug['hand_detected']}/{TARGET_FRAMES} frames)")

        print("Running inference…")
        sign, confidence, windows = _predict(
            model, frames_tensor, landmarks_tensor, device, class_names
        )
        elapsed = time.time() - t0

        print("\n" + "═" * 45)
        print(f"  Predicted  : {sign}")
        print(f"  Confidence : {confidence:.1%}")
        if TARGET_SIGN:
            tick = "✓" if sign.upper() == TARGET_SIGN.upper() else "✗"
            print(f"  Correct    : {tick}  (target: {TARGET_SIGN})")
        print(f"  Time       : {elapsed:.1f}s")
        print(f"\n  Windows ({len(windows)}):")
        for w in windows:
            print(f"    [{w['start']:>2}–{w['end']:>2}]  {w['sign']}  {w['confidence']:.1%}")
        print("═" * 45)

        # ── Visualisation ─────────────────────────────────────────────────
        predicted_idx = class_names.index(sign)
        _show_visualization(
            frames_bgr, landmarks_list,
            frames_tensor, landmarks_tensor,
            model, device, predicted_idx,
            sign, confidence,
        )

    finally:
        os.unlink(video_path)
