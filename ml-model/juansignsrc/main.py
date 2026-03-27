# ml-model/main.py
#
# JuanSign — Modal serverless GPU inference endpoint.
#
# What changed from the original:
#   - TARGET_FRAMES  : 16  → 32
#   - Frame input    : 3-ch RGB → 5-ch (RGB + optical flow)
#   - Architecture   : ResNetLSTM inlined with VisualEncoder (5-ch weight inflation),
#                      LandmarkEncoder (MLP + LSTM), BiLSTM ×2, fusion
#   - Inference      : single window → sliding window with confidence threshold
#   - Checkpoint     : state_dict only → full checkpoint dict (reads class_names)
#   - CLASS_NAMES    : hardcoded → read from checkpoint at load time
#
# Deployment:
#   modal deploy ml-model/main.py
#
# The Modal Volume "juansign-model-vol" must already contain:
#   /model-weights/juansign_model.pth   ← produced by train.py

import io
import os
import base64
import tempfile
import subprocess
from collections import deque
from typing import Optional

import numpy as np
import cv2
import torch
import torch.nn as nn
from torchvision import models
import modal

# ══════════════════════════════════════════════════════════════════════════════
# MODAL APP + IMAGE
# ══════════════════════════════════════════════════════════════════════════════

app = modal.App("juansign-inference")

# Build the container image once — only rebuilds when dependencies change.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.2.0",
        "torchvision==0.17.0",
        "opencv-python-headless==4.9.0.80",
        "mediapipe==0.10.9",
        "numpy==1.26.4",
        "supabase==2.4.2",
        "Pillow==10.2.0",
        "fastapi",        # ← removed [standard]
        "python-multipart",
        "uvicorn",
        "ffmpeg-python",
    )
    .apt_install(["curl", "libgl1", "libglib2.0-0", "ffmpeg"])
    .run_commands(
        "curl -fsSL -o /hand_landmarker.task "
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
        "hand_landmarker/float16/1/hand_landmarker.task",
        "curl -fsSL -o /face_detector.tflite "
        "https://storage.googleapis.com/mediapipe-models/face_detector/"
        "blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
    )
)

# Persistent volume holding the trained weights
model_volume = modal.Volume.from_name("juansign-model-vol")

# ══════════════════════════════════════════════════════════════════════════════
# CONSTANTS  — must match frame_extractor.py, fsl_dataset.py, architecture
# ══════════════════════════════════════════════════════════════════════════════

TARGET_FRAMES    = 32
TARGET_SIZE      = 224
HAND_PADDING     = 60
FLOW_NORM_SCALE  = 30.0

# Landmark dims
NUM_LANDMARKS    = 21
LANDMARK_FEATURE = NUM_LANDMARKS * 3      # 63

# Architecture dims
RESNET_OUT       = 512
LANDMARK_HIDDEN  = 64
LSTM_HIDDEN      = 256
LSTM_LAYERS      = 2
LSTM_TOTAL_OUT   = LSTM_HIDDEN * 2        # 512
DROPOUT_P        = 0.5

# ImageNet normalisation — must match all transform definitions
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD  = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# Sliding window inference
WINDOW_STRIDE       = 8      # new window every 8 frames (~4 inferences / 32 frames)
CONFIDENCE_THRESHOLD = 0.70  # only accept predictions above 70% confidence
MODEL_PATH = "/model-weights/model/juansign_model.pth"
HAND_MODEL = "/hand_landmarker.task"
FACE_MODEL = "/face_detector.tflite"

# ══════════════════════════════════════════════════════════════════════════════
# ARCHITECTURE  (inlined — does not import from src/)
# ══════════════════════════════════════════════════════════════════════════════

class VisualEncoder(nn.Module):
    """5-channel ResNet18 with weight inflation on Conv1."""

    def __init__(self):
        super().__init__()
        resnet   = models.resnet18(weights=None)     # no pretrained at inference
        old_conv = resnet.conv1

        new_conv = nn.Conv2d(5, 64, kernel_size=7, stride=2, padding=3, bias=False)
        # Weights initialised to zeros — loaded from checkpoint
        resnet.conv1 = new_conv

        self.feature_extractor = nn.Sequential(*list(resnet.children())[:-2])
        self.pool = nn.AdaptiveAvgPool2d((1, 1))

    def forward(self, x):
        B, T, C, H, W = x.size()
        x = x.view(B * T, C, H, W)
        x = self.feature_extractor(x)
        x = self.pool(x)
        x = x.view(B * T, RESNET_OUT)
        return x.view(B, T, RESNET_OUT)


class LandmarkEncoder(nn.Module):
    """Per-frame MLP + temporal LSTM over hand landmark sequences."""

    def __init__(self):
        super().__init__()
        self.mlp = nn.Sequential(
            nn.Linear(LANDMARK_FEATURE, 128),
            nn.BatchNorm1d(128),
            nn.ReLU(inplace=True),
            nn.Dropout(p=0.2),
            nn.Linear(128, LANDMARK_HIDDEN),
            nn.BatchNorm1d(LANDMARK_HIDDEN),
            nn.ReLU(inplace=True),
        )
        self.lstm = nn.LSTM(
            input_size  = LANDMARK_HIDDEN,
            hidden_size = LANDMARK_HIDDEN,
            num_layers  = 1,
            batch_first = True,
        )

    def forward(self, landmarks):
        B, T, _ = landmarks.size()
        lm = landmarks.view(B * T, LANDMARK_FEATURE)
        lm = self.mlp(lm)
        lm = lm.view(B, T, LANDMARK_HIDDEN)
        lm, _ = self.lstm(lm)
        return lm


class ResNetLSTM(nn.Module):
    """Full enhanced JuanSign architecture."""

    def __init__(self, num_classes):
        super().__init__()
        self.visual_encoder   = VisualEncoder()
        self.landmark_encoder = LandmarkEncoder()

        fusion_size = RESNET_OUT + LANDMARK_HIDDEN   # 576

        self.bilstm = nn.LSTM(
            input_size    = fusion_size,
            hidden_size   = LSTM_HIDDEN,
            num_layers    = LSTM_LAYERS,
            batch_first   = True,
            bidirectional = True,
            dropout       = 0.3,
        )
        self.dropout = nn.Dropout(p=DROPOUT_P)
        self.fc      = nn.Linear(LSTM_TOTAL_OUT, num_classes)

    def forward(self, frames, landmarks):
        visual_feat   = self.visual_encoder(frames)
        landmark_feat = self.landmark_encoder(landmarks)
        fused         = torch.cat([visual_feat, landmark_feat], dim=2)
        lstm_out, _   = self.bilstm(fused)
        last_hidden   = lstm_out[:, -1, :]
        out           = self.dropout(last_hidden)
        return self.fc(out)


# ══════════════════════════════════════════════════════════════════════════════
# MEDIAPIPE HELPERS  (same logic as frame_extractor.py, inlined)
# ══════════════════════════════════════════════════════════════════════════════

def _build_mediapipe():
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision

    hand_opts = mp_vision.HandLandmarkerOptions(
        base_options = mp_python.BaseOptions(model_asset_path=HAND_MODEL),
        num_hands    = 1,
        min_hand_detection_confidence = 0.3,
        min_hand_presence_confidence  = 0.3,
        min_tracking_confidence       = 0.3,
    )
    hand_detector = mp_vision.HandLandmarker.create_from_options(hand_opts)

    face_opts = mp_vision.FaceDetectorOptions(
        base_options = mp_python.BaseOptions(model_asset_path=FACE_MODEL),  # ← fixed
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


def _sample_indices(total, n=TARGET_FRAMES):
    if total <= 0:  return [0] * n
    if total <= n:  return list(range(total)) + [total - 1] * (n - total)
    return np.linspace(0, total - 1, n, dtype=int).tolist()


def _compute_optical_flow(frames_bgr):
    """
    Compute Farneback dense optical flow between consecutive frames.
    Returns float32 array [T, 2, H, W] — same as frame_extractor.py.
    """
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


def _decode_base64_to_mp4(video_b64: str) -> str:
    """
    Decode base64-encoded video and convert to MP4 format.
    
    Args:
        video_b64: Base64-encoded video bytes (any format: webm, mp4, etc.)
    
    Returns:
        Path to the converted MP4 file
    
    Raises:
        Exception: If decoding or conversion fails
    """
    import subprocess
    import time
    
    print(f"[_decode_base64_to_mp4] Decoding base64 video ({len(video_b64)} bytes)...")
    start_time = time.time()
    
    try:
        # Step 1: Decode base64
        video_bytes = base64.b64decode(video_b64)
        print(f"[_decode_base64_to_mp4] ✓ Decoded to {len(video_bytes)} bytes")
        
        # Step 2: Write decoded bytes to temporary file (preserve original format)
        with tempfile.NamedTemporaryFile(suffix=".tmp", delete=False) as tmp_input:
            tmp_input.write(video_bytes)
            tmp_input_path = tmp_input.name
        print(f"[_decode_base64_to_mp4] ✓ Temporary input file: {tmp_input_path}")
        
        # Step 3: Create MP4 output path
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_output:
            tmp_output_path = tmp_output.name
        print(f"[_decode_base64_to_mp4] ✓ Output MP4 path: {tmp_output_path}")
        
        # Step 4: Convert to MP4 using ffmpeg
        print(f"[_decode_base64_to_mp4] Converting to MP4 using ffmpeg...")
        cmd = [
            "ffmpeg",
            "-i", tmp_input_path,           # input
            "-c:v", "libx264",              # video codec
            "-preset", "ultrafast",         # speed (ultrafast for inference)
            "-crf", "23",                   # quality (23 = default)
            "-c:a", "aac",                  # audio codec
            "-y",                           # overwrite output
            tmp_output_path,                # output
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode != 0:
            print(f"[_decode_base64_to_mp4] ❌ ffmpeg failed: {result.stderr}")
            raise Exception(f"ffmpeg conversion failed: {result.stderr}")
        
        print(f"[_decode_base64_to_mp4] ✓ ffmpeg conversion complete")
        
        # Step 5: Clean up input temp file
        os.unlink(tmp_input_path)
        print(f"[_decode_base64_to_mp4] ✓ Cleaned up temporary input file")
        
        elapsed = time.time() - start_time
        print(f"[_decode_base64_to_mp4] ✓ Complete in {elapsed:.2f}s → MP4 ready at {tmp_output_path}")
        
        return tmp_output_path
        
    except Exception as e:
        print(f"[_decode_base64_to_mp4] ❌ Error: {str(e)}")
        raise


def _extract_frames(video_path, face_detector, hand_detector):
    """
    Extract TARGET_FRAMES from a video file.

    Returns:
        frames_tensor    : float32 tensor [1, T, 5, H, W]   (batch dim added)
        landmarks_tensor : float32 tensor [1, T, 63]
        debug_info       : dict with hand detection stats
    """
    import time
    start_time = time.time()
    print(f"[_extract_frames] Starting frame extraction from {video_path}")
    
    cap = cv2.VideoCapture(video_path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    indices = _sample_indices(total)
    print(f"[_extract_frames] Video loaded: {total} total frames, sampling {len(indices)} frames")

    frames_bgr     = []
    landmarks_list = []
    hand_count     = 0

    for frame_idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()

        if not ret:
            if frames_bgr:
                frames_bgr.append(frames_bgr[-1].copy())
                landmarks_list.append(landmarks_list[-1].copy())
            else:
                frames_bgr.append(np.zeros((TARGET_SIZE, TARGET_SIZE, 3), dtype=np.uint8))
                landmarks_list.append(np.zeros(LANDMARK_FEATURE, dtype=np.float32))
            continue

        frame = _anonymize_face(frame, face_detector)
        cropped, lm = _hand_crop(frame, hand_detector)

        if cropped is not None:
            hand_count += 1
            frame_bgr = cv2.resize(cropped, (TARGET_SIZE, TARGET_SIZE), interpolation=cv2.INTER_AREA)
        else:
            frame_bgr = cv2.resize(_center_crop(frame), (TARGET_SIZE, TARGET_SIZE), interpolation=cv2.INTER_AREA)

        frames_bgr.append(frame_bgr)
        landmarks_list.append(lm)

    cap.release()
    print(f"[_extract_frames] Extracted {len(frames_bgr)} frames, {hand_count} hands detected")

    # ── Build 5-channel frame tensor ─────────────────────────────────────────
    flow_array = _compute_optical_flow(frames_bgr)   # [T, 2, H, W]
    print(f"[_extract_frames] Optical flow computed: shape {flow_array.shape}")

    frame_tensors = []
    for i, bgr in enumerate(frames_bgr):
        # RGB channels — normalise with ImageNet stats
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        rgb = (rgb - IMAGENET_MEAN) / IMAGENET_STD                         # [H, W, 3]
        rgb = torch.from_numpy(rgb).permute(2, 0, 1)                       # [3, H, W]

        # Flow channels — normalise to [-1, 1]
        flow = torch.from_numpy(flow_array[i]).float() / FLOW_NORM_SCALE   # [2, H, W]
        flow = torch.clamp(flow, -1.0, 1.0)

        frame_tensors.append(torch.cat([rgb, flow], dim=0))                # [5, H, W]

    frames_tensor = torch.stack(frame_tensors).unsqueeze(0)                # [1, T, 5, H, W]
    print(f"[_extract_frames] Frames tensor built: {frames_tensor.shape}")

    # ── Build landmark tensor ─────────────────────────────────────────────────
    landmarks_np     = np.stack(landmarks_list, axis=0)                    # [T, 63]
    landmarks_tensor = torch.from_numpy(landmarks_np).unsqueeze(0)         # [1, T, 63]
    print(f"[_extract_frames] Landmarks tensor built: {landmarks_tensor.shape}")

    debug_info = {
        "total_frames"  : total,
        "hand_detected" : hand_count,
        "hand_ratio"    : round(hand_count / TARGET_FRAMES, 2),
    }
    
    elapsed = time.time() - start_time
    print(f"[_extract_frames] ✓ Complete in {elapsed:.2f}s. Hands: {hand_count}/{TARGET_FRAMES}")

    return frames_tensor, landmarks_tensor, debug_info


# ══════════════════════════════════════════════════════════════════════════════
# SLIDING WINDOW INFERENCE
# ══════════════════════════════════════════════════════════════════════════════

def _sliding_window_predict(model, frames_tensor, landmarks_tensor, device, class_names):
    """
    Run predictions over multiple overlapping windows of the clip.

    For a single isolated sign this behaves identically to a single forward
    pass — one window covers the full clip.

    For phrase-level inference (longer clips), this yields multiple predictions
    at different temporal positions, filtered by confidence threshold.

    Returns:
        sign       : str   — predicted class name (highest confidence above threshold)
        confidence : float — confidence score in [0, 1]
        all_windows: list of dicts — per-window results for debugging
    """
    import time
    start_time = time.time()
    print(f"[_sliding_window_predict] Starting sliding window inference on {frames_tensor.shape}")
    
    T           = frames_tensor.shape[1]
    all_windows = []
    best_conf   = 0.0
    best_sign   = class_names[0]

    model.eval()
    with torch.no_grad():
        # Generate window start positions
        starts = list(range(0, max(1, T - TARGET_FRAMES + 1), WINDOW_STRIDE))

        # Always include a window starting at 0 covering the full clip
        if 0 not in starts:
            starts = [0] + starts
        
        print(f"[_sliding_window_predict] Will run {len(starts)} window(s) at positions: {starts}")

        for start in starts:
            end = start + TARGET_FRAMES
            if end > T:
                break

            window_frames    = frames_tensor[:, start:end, :, :, :].to(device)
            window_landmarks = landmarks_tensor[:, start:end, :].to(device)

            logits      = model(window_frames, window_landmarks)
            probs       = torch.softmax(logits, dim=1)[0]
            conf, idx   = probs.max(dim=0)
            conf_val    = conf.item()
            sign_val    = class_names[idx.item()]

            print(f"[_sliding_window_predict] Window [{start}:{end}] → sign='{sign_val}', confidence={conf_val:.4f}")
            print(f"[_sliding_window_predict]   Raw logits: {logits[0]}")
            print(f"[_sliding_window_predict]   Softmax probs: {probs}")

            all_windows.append({
                "start"     : start,
                "end"       : end,
                "sign"      : sign_val,
                "confidence": round(conf_val, 4),
            })

            if conf_val > best_conf and conf_val >= CONFIDENCE_THRESHOLD:
                best_conf = conf_val
                best_sign = sign_val

    # If no window exceeded threshold, return the highest confidence result anyway
    if best_conf == 0.0 and all_windows:
        best_window = max(all_windows, key=lambda w: w["confidence"])
        best_sign   = best_window["sign"]
        best_conf   = best_window["confidence"]
        print(f"[_sliding_window_predict] No window exceeded threshold {CONFIDENCE_THRESHOLD}, using best: {best_sign} ({best_conf})")

    elapsed = time.time() - start_time
    print(f"[_sliding_window_predict] ✓ Complete in {elapsed:.2f}s. Final: sign='{best_sign}', confidence={best_conf:.4f}")

    return best_sign, best_conf, all_windows


# ══════════════════════════════════════════════════════════════════════════════
# MODEL LOADER
# ══════════════════════════════════════════════════════════════════════════════

def _build_model(checkpoint_path, device):
    """
    Load the full checkpoint saved by train.py.
    Reads num_classes and class_names directly from the checkpoint dict
    so main.py never needs a hardcoded CLASS_NAMES list.

    Also handles legacy checkpoints saved as a raw state_dict (no metadata keys).
    In that case, num_classes is inferred from the FC layer weight shape.
    """
    print(f"[_build_model] Loading checkpoint from {checkpoint_path} on device {device}")
    
    checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=False)

    if isinstance(checkpoint, dict) and "model_state" in checkpoint:
        # New format — full checkpoint dict from train.py
        num_classes = checkpoint["num_classes"]
        class_names = checkpoint["class_names"]
        state_dict  = checkpoint["model_state"]
        print(f"[_build_model] New checkpoint format: {num_classes} classes")
    else:
        # Legacy format — raw state_dict only
        state_dict  = checkpoint
        num_classes = state_dict["fc.weight"].shape[0]
        class_names = [str(i) for i in range(num_classes)]
        print(f"[_build_model] WARNING: legacy checkpoint detected — no class_names metadata. "
              f"Upload new checkpoint via: modal volume put juansign-model-vol "
              f"<path>/juansign_model.pth /model/juansign_model.pth")

    model = ResNetLSTM(num_classes=num_classes).to(device)
    model.load_state_dict(state_dict)
    model.eval()

    print(f"[_build_model] ✓ Model loaded. Classes ({num_classes}): {class_names}")
    print(f"[_build_model] FC layer shape: {model.fc.weight.shape}")

    return model, class_names


# ══════════════════════════════════════════════════════════════════════════════
# MODAL CLASS
# ══════════════════════════════════════════════════════════════════════════════

@app.cls(
    image   = image,
    gpu     = "T4",
    volumes = {"/model-weights": model_volume},
    secrets  = [modal.Secret.from_name("juansign-secret")],
    timeout = 120,
)
class JuanSignInference:

    @modal.enter()
    def load(self):
        """
        Called once when the container starts (cold start).
        Loads model weights and MediaPipe detectors into memory.
        Subsequent requests reuse these — no reload cost.
        """
        # Reload ensures the container sees the latest volume contents.
        # Without this, Modal may serve a stale (or empty) view of the volume.
        model_volume.reload()

        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        print(f"[Load] Device: {self.device}")

        self.model, self.class_names = _build_model(MODEL_PATH, self.device)
        self.face_detector, self.hand_detector = _build_mediapipe()

        print("[Load] Ready")

    @modal.fastapi_endpoint(method="POST", label="predict")
    def predict(self, request: dict) -> dict:
        """
        POST /predict

        Request body (JSON):
            token       : str  — Supabase JWT for the authenticated user
            video_b64   : str  — base64-encoded video bytes (accepts 'video_b64' or 'video' key)
            video       : str  — alternative key name for base64 video (fallback)
            target_sign : str  — the sign the user was attempting (for scoring)
            lesson_id   : str  — Supabase lesson UUID

        Response (JSON):
            sign        : str   — predicted FSL sign
            confidence  : float — model confidence [0, 1]
            is_correct  : bool  — predicted sign == target_sign
            accuracy    : float — running session accuracy (from Supabase)
            debug       : dict  — hand detection stats + per-window results
            error       : str   — present only if something went wrong
        """
        import time
        from supabase import create_client
        from starlette.responses import JSONResponse

        print("\n" + "="*80)
        print("[predict] ===== PREDICTION REQUEST STARTED =====")
        print("="*80)
        request_start = time.time()

        # ── Auth ──────────────────────────────────────────────────────────────
        print("\n[predict] Step 1: Verifying JWT token...")
        supabase_url = os.environ["SUPABASE_URL"]
        supabase_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        supabase     = create_client(supabase_url, supabase_key)

        try:
            user_resp = supabase.auth.get_user(request["token"])
            user_id   = user_resp.user.id
            print(f"[predict] ✓ Token verified. User ID: {user_id}")
        except Exception as e:
            print(f"[predict] ❌ Auth failed: {str(e)}")
            return JSONResponse(
                {"error": f"Unauthorized: {str(e)}"}, 
                status_code=401
            )

        # ── Decode & Convert video to MP4 ────────────────────────────────────────
        print("\n[predict] Step 2: Decoding base64 video and converting to MP4...")
        mp4_path = None
        try:
            # Accept both "video_b64" and "video" as keys (fallback for frontend compatibility)
            video_b64 = request.get("video_b64") or request.get("video")
            if not video_b64:
                raise KeyError("Missing video data: expected 'video_b64' or 'video' key")
            
            print(f"[predict] Video key found: {('video_b64' if 'video_b64' in request else 'video')}")
            mp4_path = _decode_base64_to_mp4(video_b64)
            print(f"[predict] ✓ MP4 ready: {mp4_path}")
        except Exception as e:
            print(f"[predict] ❌ Failed to convert video to MP4: {str(e)}")
            return {"error": f"Failed to convert video to MP4: {str(e)}"}

        try:
            # ── Frame extraction ───────────────────────────────────────────────
            print("\n[predict] Step 3: Extracting frames, landmarks, and optical flow...")
            frames_tensor, landmarks_tensor, debug_info = _extract_frames(
                mp4_path, self.face_detector, self.hand_detector
            )
            print(f"[predict] ✓ Frames: {frames_tensor.shape}, Landmarks: {landmarks_tensor.shape}")

            # ── Inference ─────────────────────────────────────────────────────
            print("\n[predict] Step 4: Running sliding window inference...")
            sign, confidence, window_results = _sliding_window_predict(
                self.model,
                frames_tensor,
                landmarks_tensor,
                self.device,
                self.class_names,
            )
            print(f"[predict] ✓ Final prediction: '{sign}' with {confidence:.4f} confidence")

        except Exception as e:
            print(f"[predict] ❌ Inference failed: {str(e)}")
            import traceback
            print(f"[predict] Traceback:\n{traceback.format_exc()}")
            return {"error": f"Inference failed: {str(e)}"}

        finally:
            if mp4_path:
                print(f"[predict] Cleaning up MP4 file: {mp4_path}")
                try:
                    os.unlink(mp4_path)
                except Exception as cleanup_err:
                    print(f"[predict] ⚠️  Failed to clean up MP4: {cleanup_err}")

        # ── Score ─────────────────────────────────────────────────────────────
        print("\n[predict] Step 5: Evaluating correctness...")
        target_sign = request.get("target_sign", "")
        is_correct  = sign.upper() == target_sign.upper()
        print(f"[predict] Expected: '{target_sign}', Predicted: '{sign}', Correct: {is_correct}")

        # ── Write to Supabase ─────────────────────────────────────────────────
        print("\n[predict] Step 6: Writing results to Supabase...")
        try:
            session_result = supabase.table("practice_sessions").insert({
                "user_id"    : user_id,
                "lesson_id"  : request.get("lesson_id"),
                "sign"       : sign,
                "target_sign": target_sign,
                "confidence" : round(confidence, 4),
                "is_correct" : is_correct,
            }).execute()
            print(f"[predict] ✓ Practice session recorded")

            supabase.table("cnn_feedback").insert({
                "user_id"       : user_id,
                "predicted_sign": sign,
                "target_sign"   : target_sign,
                "confidence"    : round(confidence, 4),
                "hand_ratio"    : debug_info["hand_ratio"],
            }).execute()
            print(f"[predict] ✓ CNN feedback recorded")

            # Compute running accuracy for this user
            sessions = (
                supabase.table("practice_sessions")
                .select("is_correct")
                .eq("user_id", user_id)
                .execute()
            )
            records  = sessions.data or []
            accuracy = (
                sum(1 for r in records if r["is_correct"]) / len(records)
                if records else 0.0
            )
            print(f"[predict] Running accuracy: {accuracy:.4f} ({sum(1 for r in records if r['is_correct'])}/{len(records)} correct)")

        except Exception as e:
            # DB write failure should not fail the prediction response
            print(f"[predict] ⚠️  Supabase write error: {str(e)}")
            accuracy = 0.0



        # ── Response ───────────────────────────────────────────────────────────
        print("\n[predict] Step 7: Preparing response...")
        response = {
            "sign"      : sign,
            "confidence": round(confidence, 4),
            "is_correct": is_correct,
            "accuracy"  : round(accuracy, 4),
            "debug"     : {
                **debug_info,
                "windows": window_results,
            },
        }
        print(f"[predict] ✓ Response: {response}")
        
        elapsed = time.time() - request_start
        print(f"\n[predict] ===== PREDICTION COMPLETE =====")
        print(f"[predict] Total processing time: {elapsed:.2f}s")
        print("="*80 + "\n")

        return response