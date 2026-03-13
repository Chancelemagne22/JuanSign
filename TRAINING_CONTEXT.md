# JuanSign — Full Training & Model Context

Use this document to plan changes to the training pipeline, model architecture, or prediction system. It contains every file involved, complete with source code.

---

## Project Summary

**JuanSign** is a Filipino Sign Language (FSL) learning web app (4th-year thesis).
A **ResNet18 + LSTM** model classifies hand signs from short video clips.

- **Current classes:** A, B, C, G, H (5 classes, alphabetical index order)
- **Input:** 16 frames per clip, each 224×224 RGB, ImageNet-normalized
- **Deployed on:** Modal (serverless GPU, T4) via `ml-model/main.py`
- **Weights saved at:** `ml-model/juansignmodel/juansign_model.pth`

---

## Data Pipeline (in order of execution)

### Step 1 — `data_splitter.py`

Reads raw videos from `processed_output/raw_data/<letter>/`, splits into train/test/val, copies to `unprocessed_input/`.

- Train: first 90 clips per letter
- Test: next 12 clips
- Val: remainder

```python
# ml-model/src/data_splitter.py

SOURCE_DIR   = "./processed_output/raw_data"
TRAIN_DIR    = "./unprocessed_input/training_data"
TEST_DIR     = "./unprocessed_input/testing_data"
VAL_DIR      = "./unprocessed_input/validation_data"

TRAIN_COUNT  = 90
TEST_COUNT   = 12

VIDEO_EXTS   = {".mp4", ".avi", ".mov", ".mkv"}

def split_raw_data(source_dir, train_dir, test_dir, val_dir, train_count, test_count):
    # walks source_dir/<letter>/, sorts clips alphabetically, copies to splits
    ...
    train_clips = clips[:train_count]
    test_clips  = clips[train_count : train_count + test_count]
    val_clips   = clips[train_count + test_count :]
```

---

### Step 2 — `frame_extractor.py`

Reads video files from `unprocessed_input/`, extracts exactly 16 frames per clip using MediaPipe, writes JPEGs to `processed_output/frame_extracted/`.

**Key constants:**
```python
TARGET_FRAMES = 16
TARGET_SIZE   = 224      # pixels — must match model input
HAND_PADDING  = 60       # pixels around detected hand bounding box
```

**Per-frame pipeline:**
1. Sample 16 evenly-spaced frame positions using `np.linspace`
2. **Anonymize face** — MediaPipe FaceDetector → Gaussian blur (51×51 kernel)
3. **Hand crop** — MediaPipe HandLandmarker (21 landmarks) → bounding box + 60px padding
4. **Fallback** — square center-crop when no hand detected
5. Resize to 224×224, save as `frame{i:04d}.jpg`

**Output layout:**
```
processed_output/frame_extracted/
  training_data/<letter>/clip001/frame0000.jpg … frame0015.jpg
  testing_data/<letter>/clip001/
  validation_data/<letter>/clip001/
```

**Resume system:** Tracks completed clips in `extraction_progress.txt`. Partial folders from crashes are deleted and re-extracted.

Full source:
```python
# ml-model/src/frame_extractor.py

TARGET_FRAMES   = 16
TARGET_SIZE     = 224
HAND_PADDING    = 60

def _sample_indices(total, n=TARGET_FRAMES):
    """Exactly n evenly-spaced indices; repeats last frame for short clips."""
    if total <= 0:   return [0] * n
    if total <= n:   return list(range(total)) + [total - 1] * (n - total)
    return np.linspace(0, total - 1, n, dtype=int).tolist()

def _anonymize_face(frame, face_detector):
    """Blur all detected face regions in-place."""
    ...  # MediaPipe FaceDetector → GaussianBlur(51,51)

def _hand_crop(frame, hand_detector):
    """21-landmark bounding box + HAND_PADDING crop. Returns None if no hand."""
    ...

def _center_crop(frame):
    """Square center crop — fallback when no hand detected."""
    ...

def extract_and_resize_frames(video_path, output_folder):
    # 1. Open video, get total frames
    # 2. Create HandLandmarker + FaceDetector via MediaPipe Task API
    # 3. For each sampled index:
    #    a. anonymize face
    #    b. hand crop (or center-crop fallback)
    #    c. resize to TARGET_SIZE × TARGET_SIZE
    #    d. save as frame{i:04d}.jpg
```

---

### Step 3 — `fsl_dataset.py` (PyTorch Dataset)

Loads the extracted frames into PyTorch. Used by `train.py`.

```python
# ml-model/src/fsl_dataset.py

class FSLDataset(Dataset):
    def __init__(self, root_dir, transform=None):
        # Classes = sorted subfolder names → always alphabetical
        # A=0, B=1, C=2, G=3, H=4 (for the 5-class model)
        self.classes = sorted(os.listdir(root_dir))
        # self.data = list of (clip_path, label_index) tuples

    def __getitem__(self, idx):
        # Loads all frame*.jpg files in sorted order
        # Applies transform to each frame (PIL Image)
        # Returns (torch.stack(frames), label)
        # Output tensor shape: [16, 3, 224, 224]
```

**Important:** Class indices come from `sorted(os.listdir())`. If you add new classes, the indices shift. The order in `CLASS_NAMES` in every script must match exactly.

---

## Model Architecture — `resnet_lstm_architecture.py`

```python
# ml-model/src/resnet_lstm_architecture.py

import torch
import torch.nn as nn
from torchvision import models

class ResNetLSTM(nn.Module):
    def __init__(self, num_classes):
        super().__init__()
        resnet = models.resnet18(weights=models.ResNet18_Weights.IMAGENET1K_V1)

        # Remove the final FC layer — keep everything up to AdaptiveAvgPool
        self.feature_extractor = nn.Sequential(*list(resnet.children())[:-1])
        # Output: [B*T, 512, 1, 1] → squeezed to [B*T, 512]

        self.lstm    = nn.LSTM(input_size=512, hidden_size=256, num_layers=1, batch_first=True)
        self.fc      = nn.Linear(256, num_classes)
        self.dropout = nn.Dropout(p=0.5)

    def forward(self, x):
        batch_size, timesteps, C, H, W = x.size()  # [B, 16, 3, 224, 224]

        # Flatten time into batch for ResNet: [B*16, 3, 224, 224]
        c_in = x.view(batch_size * timesteps, C, H, W)
        features = self.feature_extractor(c_in)          # [B*16, 512, 1, 1]

        # Reshape for LSTM: [B, 16, 512]
        features = features.view(batch_size, timesteps, -1)

        lstm_out, _ = self.lstm(features)                # [B, 16, 256]
        drop_out    = self.dropout(lstm_out[:, -1, :])   # take last timestep → [B, 256]

        out = self.fc(drop_out)                          # [B, num_classes]
        return out
```

**Architecture summary:**
```
Input: [B, 16, 3, 224, 224]
  ↓ Flatten to [B*16, 3, 224, 224]
  ↓ ResNet18 (pretrained ImageNet, FC removed)
    Conv1 7×7 → BN → ReLU → MaxPool
    layer1 (64ch, 56×56)
    layer2 (128ch, 28×28)
    layer3 (256ch, 14×14)
    layer4 (512ch, 7×7)
    AdaptiveAvgPool → [B*16, 512, 1, 1]
  ↓ Reshape to [B, 16, 512]
  ↓ LSTM (input=512, hidden=256, layers=1)  → [B, 16, 256]
  ↓ Take last hidden state [B, 256]
  ↓ Dropout(0.5)
  ↓ Linear(256 → num_classes)
Output: [B, num_classes] logits
```

**ResNet18 layer index map** (used by GradCAM and ForwardPassInspector):
```
feature_extractor[0]  Conv1 (7×7, 64ch, stride 2)
feature_extractor[1]  BN1
feature_extractor[2]  ReLU
feature_extractor[3]  MaxPool
feature_extractor[4]  layer1 — 2 BasicBlocks, 64ch, 56×56   ← Stage 2 (early features)
feature_extractor[5]  layer2 — 2 BasicBlocks, 128ch, 28×28
feature_extractor[6]  layer3 — 2 BasicBlocks, 256ch, 14×14
feature_extractor[7]  layer4 — 2 BasicBlocks, 512ch, 7×7    ← GradCAM target
feature_extractor[8]  AdaptiveAvgPool(1,1)                   ← 512-d frame vector
```

---

## Training — `train.py`

Full training configuration:

```python
# ml-model/src/train.py

# ── Transforms ────────────────────────────────────────────────────────────────
train_transform = transforms.Compose([
    transforms.ColorJitter(brightness=0.2, contrast=0.2),
    transforms.RandomRotation(10),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])

eval_transform = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])

# ── Datasets & Loaders ────────────────────────────────────────────────────────
train_ds      = FSLDataset('processed_output/frame_extracted/training_data',   train_transform)
testing_ds    = FSLDataset('processed_output/frame_extracted/testing_data',    eval_transform)
validation_ds = FSLDataset('processed_output/frame_extracted/validation_data', eval_transform)

train_loader      = DataLoader(train_ds,      batch_size=8, shuffle=True,  collate_fn=collate_fn)
testing_loader    = DataLoader(testing_ds,    batch_size=8, shuffle=False, collate_fn=collate_fn)
validation_loader = DataLoader(validation_ds, batch_size=8, shuffle=False, collate_fn=collate_fn)

# ── Model ─────────────────────────────────────────────────────────────────────
model = ResNetLSTM(num_classes=27).to(device)
# NOTE: num_classes=27 is set here but current weights are trained on 5 classes

# ── Backbone Freezing ─────────────────────────────────────────────────────────
FREEZE_EPOCHS = 10
# ResNet18 frozen for first 10 epochs → only LSTM + FC train
# Unfrozen at epoch 10 → full end-to-end fine-tuning

# ── Optimizer & Loss ──────────────────────────────────────────────────────────
criterion = nn.CrossEntropyLoss()
optimizer = optim.Adam(model.parameters(), lr=1e-5)

# ── LR Scheduler ──────────────────────────────────────────────────────────────
scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
    optimizer, mode='min', factor=0.5, patience=3
)
# Halves LR when val_loss stops improving for 3 consecutive epochs

# ── Training ──────────────────────────────────────────────────────────────────
epochs              = 25
EARLY_STOP_PATIENCE = 5   # stops if val_loss doesn't improve for 5 epochs
best_val_acc        = 0.0
best_val_loss       = float('inf')

# Training loop:
# 1. Forward pass → CrossEntropyLoss
# 2. Backward + Adam step
# 3. Evaluate on validation set (no gradients)
# 4. Save checkpoint if val_acc improved
# 5. Step LR scheduler on val_loss
# 6. Early stop if val_loss stagnates

# After training: load best checkpoint → evaluate on test set (once, final score)

MODEL_SAVE_PATH = 'ml-model/juansignmodel/juansign_model.pth'
# Saves state_dict only (not the full model object)

# TensorBoard: logs Loss/train, Loss/val, Acc/train, Acc/val per epoch
# launch with: tensorboard --logdir ml-model/runs
```

**collate_fn** (same in train.py and model_visualization.py — keep in sync):
```python
def collate_fn(batch):
    videos = [item[0] for item in batch]      # list of [T, 3, 224, 224]
    labels = [item[1] for item in batch]
    videos_padded = pad_sequence(videos, batch_first=True, padding_value=0)
    # pad_sequence handles variable T — frame_extractor guarantees T=16 so rarely activates
    return videos_padded, torch.tensor(labels)
```

---

## Prediction — `predict_sign.py`

Single-clip inference utility (runs from `ml-model/src/`):

```python
# ml-model/src/predict_sign.py

def predict_folder(model_path, clip_path, class_names):
    model = ResNetLSTM(num_classes=len(class_names)).to(device)
    model.load_state_dict(torch.load(model_path, map_location=device))
    model.eval()

    inference_transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    # Load first 16 .jpg files, sorted
    frames = [inference_transform(Image.open(f).convert('RGB')) for f in sorted_frames]
    input_tensor = torch.stack(frames).unsqueeze(0)   # [1, 16, 3, 224, 224]

    with torch.no_grad():
        output        = model(input_tensor)
        probabilities = torch.softmax(output, dim=1)
        confidence, predicted = torch.max(probabilities, 1)

    return class_names[predicted.item()], confidence.item() * 100

# Usage:
MODEL_FILE = "./juansignmodel/juansign_model.pth"
TEST_CLIP  = "./processed_output/frame_extracted/validation_data/B/clip070"
MY_CLASSES = ["A","B","C","D","E","F","G","H","I","J","K","L","M",
              "N","N~","O","P","Q","R","S","T","U","V","W","X","Y","Z"]
```

---

## Modal Deployment — `main.py`

The production inference endpoint. Deployed as a Modal serverless GPU function.

**Key facts:**
- Model weights are NOT bundled in the image — they live in a Modal Volume (`juansign-model-vol`)
- `hand_landmarker.task` is downloaded at image-build time into `/hand_landmarker.task`
- Frame extraction logic is inlined (does NOT import from `src/`)
- JWT is verified via `supabase.auth.get_user(token)` before any processing
- After prediction, writes to `practice_sessions` and `cnn_feedback` Supabase tables

```python
# ml-model/main.py (simplified)

CLASS_NAMES   = ["A", "B", "C", "G", "H"]   # must match trained checkpoint's fc.weight shape
TARGET_FRAMES = 16
TARGET_SIZE   = 224
HAND_PADDING  = 60
MODEL_PATH    = "/model-weights/juansign_model.pth"   # from Modal Volume

class ResNetLSTM(nn.Module):
    # Inlined copy of resnet_lstm_architecture.py
    # ResNet18 (weights=None) + LSTM(512→256) + FC(256→num_classes) + Dropout(0.5)
    # weights=None because pretrained ImageNet weights are NOT needed at inference
    ...

@app.cls(image=image, gpu="T4", volumes={"/model-weights": model_volume}, ...)
class JuanSignInference:

    @modal.enter()
    def load(self):
        self.model = _build_model(num_classes=len(CLASS_NAMES), device=self.device)

    @modal.fastapi_endpoint(method="POST", label="predict")
    def predict(self, request: dict) -> dict:
        # 1. Verify Supabase JWT
        # 2. Decode base64 video → temp .webm file
        # 3. Extract 16 frames (MediaPipe hand crop, same logic as frame_extractor.py)
        # 4. Run model → sign, confidence
        # 5. Write practice_session + cnn_feedback to Supabase
        # 6. Return { sign, confidence, is_correct, accuracy, debug_hands, debug_total_frames }
```

**IMPORTANT:** When you retrain with more classes, update `CLASS_NAMES` in `main.py` AND re-upload the `.pth` weights to the Modal Volume. The Modal image only needs to be rebuilt if Python dependencies change.

---

## Evaluation Tools

### `model_visualization.py`

Runs against the test set and produces 5 charts in `ml-model/visualization_output/`:

```python
NUM_CLASSES = 27   # set to match your trained checkpoint
CLASSES     = ["A","B","C","D","E","F","G","H","I","J","K","L","M",
               "N","N~","O","P","Q","R","S","T","U","V","W","X","Y","Z"]

# Outputs:
# 1_confusion_matrix_raw.png        — sample count heatmap
# 2_confusion_matrix_normalized.png — recall % (row-normalized)
# 3_per_class_accuracy.png          — bar chart, green/orange/red thresholds
# 4_precision_recall_f1.png         — grouped bar chart per class
# 5_top_confusions.png              — top 10 most confused sign pairs
```

### `gradcam.py`

Grad-CAM saliency on a single frame, targeting `feature_extractor[7]` (ResNet18 layer4).

```python
class GradCAM:
    # Hooks: forward saves activations [B*T, 512, 7, 7]
    #        backward saves gradients  [B*T, 512, 7, 7]

    def compute(self, clip_tensor, class_idx=None):
        # Forward pass (with gradients — no torch.no_grad())
        # Backward on target class logit
        # weights = gradients.mean(spatial dims)      [T, 512, 1, 1]
        # cam = (weights * activations).sum(channels) [T, 7, 7]
        # cam = cam.mean(time axis)                   [7, 7]
        # ReLU + normalize to [0,1]
        return cam, class_idx
```

### `forward_pass_viz.py`

7-stage visualization of the full forward pass for one clip:

```
Stage 1 — Raw Input         16 frames temporal grid
Stage 2 — Early CNN         layer1 activations [64ch, 56×56], frame t=0
Stage 3 — Deep CNN          layer4 activations [512ch, 7×7], frame t=0
Stage 4 — Frame Features    16×512 temporal feature matrix (CNN→LSTM bridge)
Stage 5 — LSTM States       16×256 hidden-state sequence; last row → classifier
Stage 6 — Grad-CAM          saliency overlaid on 4 representative frames
Stage 7 — Classification    softmax probability bar chart
```

### `realtime_inference.py`

Sliding-window webcam inference:
- Maintains a ring buffer of 16 frames (`deque(maxlen=16)`)
- Runs inference every `--stride` frames (default 8 ≈ 2 inferences/sec at 30fps)
- Overlays prediction + confidence on live display
- Bottom strip shows LSTM hidden-state norms (||h_t||) per timestep
- `g` key toggles live Grad-CAM overlay
- Logs timestamp/prediction/confidence to a CSV session log

---

## Constants That Must Stay in Sync Across Files

These values are duplicated across multiple files. If you change one, change all:

| Constant | Value | Files |
|---|---|---|
| `TARGET_FRAMES` | 16 | `frame_extractor.py`, `train.py` (via dataset), `main.py`, `realtime_inference.py` |
| `TARGET_SIZE` | 224 | `frame_extractor.py`, all transform definitions |
| `HAND_PADDING` | 60 | `frame_extractor.py`, `main.py` |
| ImageNet mean | `[0.485, 0.456, 0.406]` | all transform definitions |
| ImageNet std | `[0.229, 0.224, 0.225]` | all transform definitions |
| `CLASS_NAMES` order | alphabetical `sorted()` | `fsl_dataset.py`, `predict_sign.py`, `model_visualization.py`, `gradcam.py`, `realtime_inference.py`, `main.py` |
| LSTM hidden size | 256 | `resnet_lstm_architecture.py`, `main.py` (inlined) |
| LSTM input size | 512 | same as above (must match ResNet18 output) |

---

## Known Inconsistency to Be Aware Of

`train.py` line 106 sets `num_classes=27` but the current weights (`juansign_model.pth`) were trained on **5 classes (A, B, C, G, H)**. The `fc.weight` shape is `[5, 256]`.

- `main.py` correctly uses `CLASS_NAMES = ["A", "B", "C", "G", "H"]` (5 classes)
- `model_visualization.py`, `gradcam.py`, `realtime_inference.py`, `predict_sign.py` still reference 27 classes

When you retrain, make sure `num_classes` in `train.py` and `CLASS_NAMES` lists everywhere are updated consistently.

---

## File Map

```
ml-model/
├── main.py                          ← Modal GPU endpoint (production inference)
├── juansignmodel/
│   └── juansign_model.pth           ← saved state_dict (fc.weight shape = [5, 256] currently)
└── src/
    ├── resnet_lstm_architecture.py  ← ResNetLSTM class definition
    ├── train.py                     ← training loop, optimizer, scheduler, early stopping
    ├── fsl_dataset.py               ← FSLDataset (loads 16-frame clip folders)
    ├── frame_extractor.py           ← video → 16 JPEGs (MediaPipe hand crop + face blur)
    ├── data_splitter.py             ← raw_data/ → train/test/val split
    ├── predict_sign.py              ← single-clip inference utility
    ├── model_visualization.py       ← confusion matrix + per-class metrics
    ├── gradcam.py                   ← Grad-CAM saliency (layer4 target)
    ├── forward_pass_viz.py          ← 7-stage pipeline visualization
    ├── realtime_inference.py        ← live webcam sliding-window inference
    └── analyze_video.py             ← per-video batch analysis + annotated output video
```
