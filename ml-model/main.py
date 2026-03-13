# main.py — Modal serverless GPU endpoint for JuanSign
#
# Deploy:   modal deploy main.py
#
# Modal secrets (set via: modal secret create juansign-secrets):
#   SUPABASE_URL              → Supabase project URL
#   SUPABASE_SERVICE_ROLE_KEY → service role key (never in frontend)
#   SUPABASE_JWT_SECRET       → found in Supabase dashboard → Settings → JWT
#
# Modal volume (run once to create + upload weights):
#   modal volume create juansign-model-vol
#   modal volume put juansign-model-vol ml-model/juansignmodel/juansign_model.pth /
#
# Request body (POST JSON):
#   { video: <base64 webm>, token: <supabase JWT>,
#     expected_sign: "B", level_id: "<uuid>" }
#
# Response JSON:
#   { sign: "B", confidence: 94.3, is_correct: true, accuracy: 0.943 }

import modal
import base64
import tempfile
import os

# ── App ────────────────────────────────────────────────────────────────────────

app = modal.App("juansign")

# ── Container image ────────────────────────────────────────────────────────────
# Downloads the MediaPipe hand landmark model at image-build time so it's
# always available without a runtime download.

_HAND_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(
        "libgl1",
        "libglib2.0-0",
        "libsm6",
        "libxext6",
    )
    .pip_install(
        "fastapi[standard]",
        "torch==2.2.0",
        "torchvision==0.17.0",
        "opencv-python-headless==4.9.0.80",
        "mediapipe==0.10.11",
        "Pillow==10.2.0",
        "supabase==2.4.3",
        "numpy==1.26.4",
    )
    .run_commands(
        "python -c \""
        "import urllib.request; "
        f"urllib.request.urlretrieve('{_HAND_MODEL_URL}', '/hand_landmarker.task')"
        "\""
    )
)

# ── Volume (model weights) ─────────────────────────────────────────────────────
# After creating the volume, upload once:
#   modal volume put juansign-model-vol ml-model/juansignmodel/juansign_model.pth /

model_volume = modal.Volume.from_name("juansign-model-vol", create_if_missing=True)
MODEL_PATH      = "/model-weights/juansign_model.pth"
HAND_MODEL_PATH = "/hand_landmarker.task"

# ── Constants (must match training setup) ──────────────────────────────────────

# 5 classes the model was trained on — confirmed by fc.weight shape [5, 256] in checkpoint.
# Alphabetical order from sorted(os.listdir()) used during training.
CLASS_NAMES = ["A", "B", "C", "G", "H"]
TARGET_FRAMES = 16
TARGET_SIZE   = 224
HAND_PADDING  = 60


# ── Inline model architecture (mirrors resnet_lstm_architecture.py) ────────────
# Kept inline so Modal doesn't need to import from the local ml-model/ folder.

def _build_model(num_classes: int, device):
    import torch
    import torch.nn as nn
    from torchvision import models

    class ResNetLSTM(nn.Module):
        def __init__(self, num_classes):
            super().__init__()
            resnet = models.resnet18(weights=None)
            self.feature_extractor = nn.Sequential(*list(resnet.children())[:-1])
            self.lstm    = nn.LSTM(input_size=512, hidden_size=256,
                                   num_layers=1, batch_first=True)
            self.fc      = nn.Linear(256, num_classes)
            self.dropout = nn.Dropout(p=0.5)

        def forward(self, x):
            B, T, C, H, W = x.size()
            features = self.feature_extractor(x.view(B * T, C, H, W))
            features = features.view(B, T, -1)
            out, _   = self.lstm(features)
            return self.fc(self.dropout(out[:, -1, :]))

    model = ResNetLSTM(num_classes=num_classes).to(device)
    model.load_state_dict(torch.load(MODEL_PATH, map_location=device))
    model.eval()
    return model


# ── Frame extraction (adapted from frame_extractor.py for single-video) ────────
# Samples TARGET_FRAMES evenly, applies MediaPipe hand crop per frame,
# falls back to center crop when no hand is detected.

def _extract_frames(video_path: str):
    """
    Returns a list of TARGET_FRAMES torch tensors, each (3, 224, 224),
    using the same preprocessing as training (ImageNet normalisation).
    """
    import cv2
    import numpy as np
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision
    from PIL import Image as PILImage
    from torchvision import transforms

    transform = transforms.Compose([
        transforms.Resize((TARGET_SIZE, TARGET_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406],
                             std=[0.229, 0.224, 0.225]),
    ])

    # Hand detector
    hand_det = vision.HandLandmarker.create_from_options(
        vision.HandLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=HAND_MODEL_PATH),
            running_mode=vision.RunningMode.IMAGE,
            num_hands=1,
        )
    )

    cap   = cv2.VideoCapture(video_path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if total <= 0:
        indices = [0] * TARGET_FRAMES
    elif total <= TARGET_FRAMES:
        indices = list(range(total)) + [total - 1] * (TARGET_FRAMES - total)
    else:
        indices = np.linspace(0, total - 1, TARGET_FRAMES, dtype=int).tolist()

    frames = []
    hands_detected = 0
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()

        if not ret:
            blank = np.zeros((TARGET_SIZE, TARGET_SIZE, 3), dtype=np.uint8)
            frames.append(transform(PILImage.fromarray(blank)))
            continue

        h, w  = frame.shape[:2]
        rgb   = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_im = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        res   = hand_det.detect(mp_im)

        if res.hand_landmarks:
            hands_detected += 1
            lm = res.hand_landmarks[0]
            xs = [pt.x * w for pt in lm]
            ys = [pt.y * h for pt in lm]
            x1 = max(0, int(min(xs)) - HAND_PADDING)
            y1 = max(0, int(min(ys)) - HAND_PADDING)
            x2 = min(w, int(max(xs)) + HAND_PADDING)
            y2 = min(h, int(max(ys)) + HAND_PADDING)
            crop = frame[y1:y2, x1:x2] if x2 > x1 and y2 > y1 else frame
        else:
            # center-crop fallback
            s    = min(h, w)
            crop = frame[(h - s) // 2:(h - s) // 2 + s,
                         (w - s) // 2:(w - s) // 2 + s]

        resized = cv2.resize(crop, (TARGET_SIZE, TARGET_SIZE),
                             interpolation=cv2.INTER_AREA)
        frames.append(transform(PILImage.fromarray(
            cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        )))

    cap.release()
    return frames, hands_detected, total


# ── Inference class ────────────────────────────────────────────────────────────

@app.cls(
    image=image,
    gpu="T4",
    volumes={"/model-weights": model_volume},
    secrets=[modal.Secret.from_name("juansign-secret")],
    min_containers=1,
)
class JuanSignInference:

    @modal.enter()
    def load(self):
        import torch
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model  = _build_model(num_classes=len(CLASS_NAMES), device=self.device)
        print(f"[JuanSign] Model ready on {self.device}")

    @modal.fastapi_endpoint(method="POST", label="predict")
    def predict(self, request: dict) -> dict:
        import torch
        from supabase import create_client
        from fastapi import HTTPException

        # ── 1. Verify token ───────────────────────────────────────────────────
        token = request.get("token")
        if not token:
            raise HTTPException(status_code=401, detail="Missing token")

        try:
            sb = create_client(
                os.environ["SUPABASE_URL"],
                os.environ["SUPABASE_SERVICE_ROLE_KEY"],
            )
            user_id = sb.auth.get_user(token).user.id
        except Exception as exc:
            raise HTTPException(status_code=401, detail=f"Invalid token: {exc}")

        # ── 2. Decode base64 video → temp file ───────────────────────────────
        video_b64 = request.get("video")
        if not video_b64:
            raise HTTPException(status_code=400, detail="Missing video")

        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
            f.write(base64.b64decode(video_b64))
            tmp_path = f.name

        try:
            # ── 3. Extract 16 frames ──────────────────────────────────────────
            frames, hands_detected, video_total_frames = _extract_frames(tmp_path)

            # ── 4. Run model ──────────────────────────────────────────────────
            tensor = torch.stack(frames).unsqueeze(0).to(self.device)
            with torch.no_grad():
                probs      = torch.nn.functional.softmax(self.model(tensor), dim=1)
                conf, pred = torch.max(probs, 1)

            sign       = CLASS_NAMES[pred.item()]
            confidence = round(float(conf.item()) * 100, 2)

            # ── 5. Correctness + accuracy ─────────────────────────────────────
            expected   = (request.get("expected_sign") or "").upper().strip()
            is_correct = sign == expected
            accuracy   = round(float(conf.item()), 4) if is_correct else 0.0

            # ── 6. Create practice_session, then write cnn_feedback ───────────
            level_id = (request.get("level_id") or "").strip()
            if not level_id:
                raise ValueError("Missing level_id — required to create practice session")

            session_row = sb.table("practice_sessions").insert({
                "auth_user_id":     user_id,
                "level_id":         level_id,
                "average_accuracy": accuracy,
            }).execute()
            session_id = session_row.data[0]["session_id"]

            sb.table("cnn_feedback").insert({
                "auth_user_id":     user_id,
                "session_id":       session_id,
                "accuracy_score":   accuracy,
                "feedback_message": (
                    f"Correct! Signed '{sign}' with {confidence:.1f}% confidence."
                    if is_correct else
                    f"Expected '{expected}', model predicted '{sign}' ({confidence:.1f}%)."
                ),
            }).execute()

            # ── 7. Return to frontend ─────────────────────────────────────────
            return {
                "sign":                sign,
                "confidence":          confidence,
                "is_correct":          is_correct,
                "accuracy":            accuracy,
                "debug_hands":         hands_detected,
                "debug_total_frames":  video_total_frames,
            }

        finally:
                os.unlink(tmp_path)
            
