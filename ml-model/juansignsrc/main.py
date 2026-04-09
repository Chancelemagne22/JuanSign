# ml-model/main.py
#
# JuanSign V2.2 — Production Inference Endpoint
# Backbone: ResNet50 | Data: Dual-Hand Relative Landmarks
#
# Changes:
#   - FIXED: Landmark MLP first layer size (256) to match trained checkpoint.
#   - ADDED: Relative Landmark Normalization (Wrist-subtraction).
#   - ADDED: Forward Fill (Heal) logic for missing hand frames.
#   - UPDATED: RESNET_OUT = 2048 for ResNet50.

import io
import os
import base64
import tempfile
import subprocess
import time
from collections import deque
from typing import Optional

import numpy as np
import cv2
import torch
import torch.nn as nn
from torchvision import models
import modal

# ══════════════════════════════════════════════════════════════════════════════
# MODAL APP & ENVIRONMENT SETUP
# ══════════════════════════════════════════════════════════════════════════════

app = modal.App("juansign-inference")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.2.0",
        "torchvision==0.17.0",
        "opencv-python-headless==4.9.0.80",
        "mediapipe==0.10.11",
        "numpy==1.26.4",
        "supabase==2.4.2",
        "Pillow==10.2.0",
        "fastapi",
        "python-multipart",
        "uvicorn",
        "ffmpeg-python",
    )
    .apt_install(["curl", "libgl1", "libglib2.0-0", "ffmpeg"])
    .run_commands(
        "curl -fsSL -o /hand_landmarker.task https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        "curl -fsSL -o /face_detector.tflite https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
    )
)

model_volume = modal.Volume.from_name("juansign-model-vol")

# ── CONSTANTS (Must match train.py) ───────────────────────────────────────────
TARGET_FRAMES    = 32
TARGET_SIZE      = 224
HAND_PADDING     = 40
FLOW_NORM_SCALE  = 30.0

LANDMARK_FEATURE = 126  # 2 hands
LANDMARK_HIDDEN  = 128  
RESNET_OUT       = 2048 # ResNet50 output dimension
LSTM_HIDDEN      = 256
LSTM_LAYERS      = 2
LSTM_TOTAL_OUT   = 512

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD  = np.array([0.229, 0.224, 0.225], dtype=np.float32)

CONFIDENCE_THRESHOLD = 0.70
MODEL_PATH = "/model-weights/model/juansign_model_v2_2.pth"
HAND_MODEL = "/hand_landmarker.task"
FACE_MODEL = "/face_detector.tflite"

# ══════════════════════════════════════════════════════════════════════════════
# MODEL ARCHITECTURE (SYNCED WITH V2.2 CHECKPOINT)
# ══════════════════════════════════════════════════════════════════════════════

class VisualEncoder(nn.Module):
    def __init__(self):
        super().__init__()
        resnet = models.resnet50(weights=None)
        resnet.conv1 = nn.Conv2d(5, 64, kernel_size=7, stride=2, padding=3, bias=False)
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
    def __init__(self):
        super().__init__()
        # FIXED: layer size 256 to match the size mismatch error in logs
        self.mlp = nn.Sequential(
            nn.Linear(LANDMARK_FEATURE, 256),
            nn.BatchNorm1d(256),
            nn.ReLU(inplace=True),
            nn.Dropout(p=0.2),
            nn.Linear(256, LANDMARK_HIDDEN),
            nn.BatchNorm1d(128),
            nn.ReLU(inplace=True),
        )
        self.lstm = nn.LSTM(LANDMARK_HIDDEN, LANDMARK_HIDDEN, 1, batch_first=True)

    def forward(self, landmarks):
        B, T, _ = landmarks.size()
        lm = landmarks.view(B * T, LANDMARK_FEATURE)
        lm = self.mlp(lm)
        lm = lm.view(B, T, LANDMARK_HIDDEN)
        lm, _ = self.lstm(lm)
        return lm

class ResNetLSTM(nn.Module):
    def __init__(self, num_classes):
        super().__init__()
        self.visual_encoder = VisualEncoder()
        self.landmark_encoder = LandmarkEncoder()
        self.bilstm = nn.LSTM(RESNET_OUT + LANDMARK_HIDDEN, LSTM_HIDDEN, LSTM_LAYERS, 
                              batch_first=True, bidirectional=True, dropout=0.5)
        self.dropout = nn.Dropout(p=0.7)
        self.fc = nn.Linear(LSTM_TOTAL_OUT, num_classes)

    def forward(self, frames, landmarks):
        v = self.visual_encoder(frames)
        l = self.landmark_encoder(landmarks)
        fused = torch.cat([v, l], dim=2)
        out, _ = self.bilstm(fused)
        return self.fc(self.dropout(out[:, -1, :]))

# ══════════════════════════════════════════════════════════════════════════════
# INFERENCE UTILITIES
# ══════════════════════════════════════════════════════════════════════════════

def _normalize_landmarks_relative(lm_tensor):
    """Subtracts wrist from landmarks to ensure room-invariance."""
    lm = lm_tensor.clone()
    for hand_offset in [0, 63]:
        wrist = lm[:, :, hand_offset:hand_offset+3]
        lm[:, :, hand_offset:hand_offset+63] -= wrist.repeat(1, 1, 21)
    return lm

def _build_mediapipe():
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision
    
    hand_opts = mp_vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=HAND_MODEL, delegate=mp_python.BaseOptions.Delegate.CPU ),
        num_hands=2, min_hand_detection_confidence=0.3
    )
    face_opts = mp_vision.FaceDetectorOptions(
        base_options=mp_python.BaseOptions(model_asset_path=FACE_MODEL, delegate=mp_python.BaseOptions.Delegate.CPU ),
        min_detection_confidence=0.4
    )
    return mp_vision.FaceDetector.create_from_options(face_opts), mp_vision.HandLandmarker.create_from_options(hand_opts)

def _compute_optical_flow(frames_bgr):
    flow_array = np.zeros((TARGET_FRAMES, 2, TARGET_SIZE, TARGET_SIZE), dtype=np.float32)
    grays = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in frames_bgr]
    for i in range(1, TARGET_FRAMES):
        flow = cv2.calcOpticalFlowFarneback(grays[i-1], grays[i], None, 0.5, 3, 15, 3, 5, 1.2, 0)
        flow_array[i, 0], flow_array[i, 1] = flow[:, :, 0], flow[:, :, 1]
    return flow_array

def _decode_base64_to_mp4(video_b64):
    video_bytes = base64.b64decode(video_b64)
    tmp_input = tempfile.NamedTemporaryFile(suffix=".tmp", delete=False)
    tmp_output = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp_input.write(video_bytes)
    tmp_input.close()
    
    # FFmpeg converts any browser format (WebM/QuickTime) to standardized H.264
    subprocess.run(["ffmpeg", "-i", tmp_input.name, "-c:v", "libx264", "-preset", "ultrafast", "-y", tmp_output.name], 
                   capture_output=True)
    os.unlink(tmp_input.name)
    return tmp_output.name

def _extract_frames(video_path, face_detector, hand_detector):
    cap = cv2.VideoCapture(video_path)
    indices = np.linspace(0, int(cap.get(cv2.CAP_PROP_FRAME_COUNT))-1, TARGET_FRAMES, dtype=int)
    
    # HEAL Logic variables
    last_valid_frame, last_valid_lm = None, None
    extracted_bgr, landmarks_list = [], []
    
    # Pre-scan for face anchor
    ret, first_frame = cap.read()
    face_center = [0.5, 0.5, 0.0]
    if ret:
        rgb = cv2.cvtColor(first_frame, cv2.COLOR_BGR2RGB)
        import mediapipe as mp
        res = face_detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        if res.detections:
            bb = res.detections[0].bounding_box
            face_center = [bb.origin_x + bb.width/2, bb.origin_y + bb.height/2, 0.0]
    
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()
        
        if ret:
            # Face blur
            frame = cv2.GaussianBlur(frame, (51, 51), 0)
            
            # Hand detection
            import mediapipe as mp
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = hand_detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
            
            if res.hand_landmarks:
                xs, ys, coords = [], [], []
                for i in range(2):
                    if len(res.hand_landmarks) > i:
                        for lm in res.hand_landmarks[i]:
                            xs.append(int(lm.x * frame.shape[1]))
                            ys.append(int(lm.y * frame.shape[0]))
                            coords.extend([lm.x, lm.y, lm.z])
                    else: coords.extend(face_center * 21)
                
                # Crop and Fill
                x1, y1 = max(0, min(xs)-HAND_PADDING), max(0, min(ys)-HAND_PADDING)
                x2, y2 = min(frame.shape[1], max(xs)+HAND_PADDING), min(frame.shape[0], max(ys)+HAND_PADDING)
                crop = frame[y1:y2, x1:x2]
                if crop.size > 0:
                    last_valid_frame = cv2.resize(crop, (TARGET_SIZE, TARGET_SIZE))
                    last_valid_lm = np.array(coords, dtype=np.float32)

        # Forward fill logic
        extracted_bgr.append(last_valid_frame if last_valid_frame is not None else np.zeros((TARGET_SIZE, TARGET_SIZE, 3), dtype=np.uint8))
        landmarks_list.append(last_valid_lm if last_valid_lm is not None else np.tile(face_center, 42))

    cap.release()
    flow = _compute_optical_flow(extracted_bgr)
    
    # Build final Tensors
    frame_tensors = []
    for i, bgr in enumerate(extracted_bgr):
        rgb = (cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32)/255.0 - IMAGENET_MEAN)/IMAGENET_STD
        f_chan = torch.from_numpy(flow[i]).float() / FLOW_NORM_SCALE
        frame_tensors.append(torch.cat([torch.from_numpy(rgb).permute(2,0,1), torch.clamp(f_chan, -1.0, 1.0)], dim=0))
    
    lms_raw = torch.from_numpy(np.array(landmarks_list)).float().unsqueeze(0)
    return torch.stack(frame_tensors).unsqueeze(0), _normalize_landmarks_relative(lms_raw)

def _build_model(checkpoint_path, device):
    checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=False)
    num_classes = checkpoint["num_classes"]
    class_names = checkpoint["class_names"]
    model = ResNetLSTM(num_classes=num_classes).to(device)
    model.load_state_dict(checkpoint["model_state"])
    model.eval()
    return model, class_names

# ══════════════════════════════════════════════════════════════════════════════
# MODAL ENDPOINT CLASS
# ══════════════════════════════════════════════════════════════════════════════

@app.cls(image=image, gpu="T4",keep_warm=1, volumes={"/model-weights": model_volume}, 
         secrets=[modal.Secret.from_name("juansign-secret")], timeout=180)
class JuanSignInference:

    @modal.enter()
    def load(self):
        model_volume.reload()
        self.device = torch.device("cuda")
        self.model, self.class_names = _build_model(MODEL_PATH, self.device)
        self.face_detector, self.hand_detector = _build_mediapipe()

    @modal.fastapi_endpoint(method="POST", label="predict")
    def predict(self, request: dict):
        from supabase import create_client
        from starlette.responses import JSONResponse
        
        # 1. Auth
        supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
        try:
            user_id = supabase.auth.get_user(request["token"]).user.id
        except: return JSONResponse({"error": "Auth failed"}, status_code=401)

        # 2. Process Video
        mp4_path = _decode_base64_to_mp4(request.get("video_b64") or request.get("video"))
        frames_t, lms_t = _extract_frames(mp4_path, self.face_detector, self.hand_detector)
        os.unlink(mp4_path)

        # 3. Predict
        with torch.no_grad():
            logits = self.model(frames_t.to(self.device), lms_t.to(self.device))
            probs = torch.softmax(logits, dim=1)[0]
            conf, idx = torch.max(probs, dim=0)
            sign = self.class_names[idx.item()]

        # 4. DB Log
        target = request.get("expected_sign", "")
        sign = self.class_names[idx.item()]
        is_correct = sign.upper() == target.upper()
        
        # Ensure we are sending the exact column names from your Supabase screenshot
        supabase.table("practice_sessions").insert({
            "user_id": user_id,              # Was auth_user_id in your screenshot
            "level_id": request.get("level_id"), # Make sure frontend sends this!
            "sign": sign,
            "target_sign": target,
            "confidence": round(conf.item(), 4), # We renamed average_accuracy to this
            "is_correct": is_correct
        }).execute()

        # 5. Return prediction result to frontend
        return JSONResponse({
            "sign": sign,
            "confidence": round(conf.item(), 4),
            "is_correct": is_correct,
            "accuracy": round(conf.item(), 4)  # Same as confidence for now
        })