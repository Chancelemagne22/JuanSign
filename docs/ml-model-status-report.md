# JuanSign ML Model — Technical Status Report

**Date:** 2026-09-24
**Root:** `ml-model/`
**Current pipeline:** `ml-model/modal_training/` (authoritative)
**Deprecated:** `ml-model/juansignsrc/` — DO NOT USE (A–E pilot era, kept for reference only)
**Architecture:** ResNet50 (5-ch RGB+Flow) + Dual-Hand Landmark Encoder + 2-layer BiLSTM
**Cloud:** Modal (`App juansign-v2-2-training`, Volume `juansign-model-vol`, GPU A10G)
**Report scope:** read-only audit of working tree. No training jobs launched for this report.

---

## 1. Directory Map & File Roles

```
ml-model/
  modal_training/              # ★ CURRENT — Modal cloud + local hybrid
    modal_run.py               # orchestrator (image, volume, 4 remote fns, 5 entrypoints)
    train_main.py              # training entry (552 lines, 50 epochs, AMP, torchmetrics)
    resnet_lstm_architecture.py# model def (229 lines, VisualEncoder + LandmarkEncoder + ResNetLSTM)
    fsl_datasets.py            # loaders (204 lines, CachedFSLDataset + FSLDataset + collate_fn)
    frame_extractor.py         # preprocessing (364 lines, 32-frame hand-crop + flow + landmarks)
    cache_dataset.py           # optimizer (110 lines, packs splits to /data/cache/*.pt)
    download_result.py         # artifact puller (25 lines, 7 files — omits .pth)
    juansignmodel/             # EMPTY (local target never materialized)
    results/                   # EMPTY (local target never pulled)
    __pycache__/               # stale modal_run bytecode only
  juansignsrc/                 # ⚠ OUTDATED — A–E pilot (train.py, main.py inference ref, checkpoint.py, etc.)
  category_models/             # 3× ~115 MB legacy per-category checkpoints
    5whs.pth (121,451,530 B, 2026-05-20)
    days_of_week.pth (121,457,730 B, 2026-05-07)
    greetings.pth (121,451,594 B, 2026-07-18)
  requirements.txt             # 10 pins (missing torchmetrics/fvcore/torchinfo — §7.1)
  check.py                     # 3-line CUDA smoke test
  colab_juansign.ipynb         # 288 lines, 12 cells — OUTDATED (refs src/ paths that no longer exist)
  file_structure.json          # 5-line placeholder (typo fileanme, unused)
  envprocess.txt               # generic venv notes, no project steps
  blaze_face_short_range.tflite (0.22 MB) + hand_landmarker.task (7.46 MB)  # local MediaPipe assets
  evaluation_results.png (23 KB) / final_confusion_matrix.png (94 KB) /
    gradcam_output.png (244 KB)  # 2026-05-01 A–E pilot artifacts, NOT V2.2
  session_log.csv (23 lines)   # 2026-03-05 realtime debugger dump (M,P,X,Z,W,Q @ 8–20% conf)
  extraction_progress.txt (821 lines)  # stale A–E log (training_data/A/... naming)
  unprocessed_input/           # EMPTY (raw videos live on Modal Volume only)
  venv/  __pycache__/          # local env / bytecode, not audited
```

**Why two pipelines exist:** `juansignsrc/` was the original local/Colab codebase (single-machine, `training_data/` naming, classes A–E). It was superseded by `modal_training/` when the team moved to Modal cloud GPUs and real FSL greetings data. `juansignsrc/` was intentionally frozen rather than deleted so the old inference server (`main.py`) remains readable as a reference. All new work must target `modal_training/`.

---

## 2. Model Architecture (`resnet_lstm_architecture.py`, 229 lines)

Multimodal, per-clip classification. Input contract (must match extractor + loader exactly):

```
frames:    [B, 32, 5, 224, 224]   # 3× RGB (ImageNet-norm) + 2× optical flow (/30, clamp [-1,1])
landmarks: [B, 32, 126]           # 2 hands × 21 pts × (x,y,z), wrist-relative norm at load time
output:    [B, NUM_CLASSES]       # NUM_CLASSES=5 (greetings); self-test uses 28 (future target)
```

### 2.1 Stream A — `VisualEncoder` (ResNet50)

```python
resnet = models.resnet50(weights=IMAGENET1K_V1)
# Weight inflation: conv1 3→5ch. RGB weights copied; flow ch init = mean(RGB) expanded to 2ch.
new_conv.weight[:, :3] = old_conv.weight
new_conv.weight[:, 3:] = mean_rgb.expand(-1, 2, -1, -1)
trunk = Sequential(*list(resnet.children())[:-2])  # → [B*T, 2048, 7, 7]
pool  = AdaptiveAvgPool2d((1,1))                   # → [B, T, 2048]
```

Forward flattens time into batch (`[B*T,5,224,224]`), extracts, reshapes to `[B,T,2048]`.

### 2.2 Stream B — `LandmarkEncoder` (126 → 128)

```
Linear(126→256) + BN + ReLU + Dropout(0.3) → Linear(256→128) + BN + ReLU
  → LSTM(128,128,1,batch_first)  # per-frame MLP (B*T) then geometric trajectory LSTM
Output: [B, T, 128]
```

### 2.3 Fusion + Temporal (`ResNetLSTM`)

```
fused = concat([visual 2048, landmark 128]) = 2176-dim per frame
bilstm = LSTM(2176, 256, 2, bidirectional, dropout=0.5)  # → [B,32,512]
logits = Dropout(0.7) → Linear(512, num_classes) on last timestep
```

Helpers: `freeze_backbone()` / `unfreeze_backbone()` (toggles `visual_encoder.requires_grad`), `count_parameters()` (~25–30M total; exact via torchinfo at train start). `DROPOUT_P=0.7` is deliberately high — **reason:** ResNet50 memorizes studio backgrounds quickly on small FSL datasets; heavy head dropout + frozen backbone phase forces generalization to hands/motion.

**Constants (must stay in sync across 3 files):** `TARGET_FRAMES=32`, `RESNET_OUT=2048`, `LANDMARK_FEATURE=126`, `LANDMARK_HIDDEN=128`, `LSTM_HIDDEN=256`, `LSTM_LAYERS=2`.

---

## 3. Data Pipeline (3 stages)

### 3.1 Stage 1 — Frame extraction (`frame_extractor.py`, 364 lines)

```
unprocessed_input/{training,testing,validation}/{class}/*.{mp4,avi,mov,mkv,webm}
  → _sample_indices(total, 32)          # linspace; short clips pad-last
  → per frame:
      _anonymize_face()                 # MediaPipe FaceDetector (conf 0.4), 51×51 blur;
                                        # face-center fallback [0.5,0.5,0] as landmark anchor
      _hand_crop()                      # all-hands bbox + HAND_PADDING=50 → 224×224
      blank-frame fix                   # pre-scan _get_first_valid_frame, carry-forward
                                        # last_valid_frame/lms, else center-crop + tiled face anchor
  → per clip folder:
      frame0000.jpg … frame0031.jpg     # 224×224 hand crop, face-blurred
      optical_flow.npy  [32,2,224,224]  # Farneback dense flow
      landmarks.npy     [32,126]        # 2×63; missing hand = tiled face-center
  → _is_valid_clip_folder() gate + PROGRESS_FILE (resume-safe)
Output: /data/processed_output/frame_extracted/{training,testing,validation}/{class}/{clip}/
```

Class filter at `frame_extractor.py:333` restricts to the 5 greetings (`good_afternoon, good_evening, good_midday, good_morning, good_night`). **Why hardcoded:** prevents stray folders (e.g. `.ipynb_checkpoints`, `__MACOSX`, or a half-uploaded 6th class) from silently entering training with wrong labels. Side effect: adding a new phrase without editing code yields zero clips with no error (§7.5).

MediaPipe assets: `hand_landmarker.task` (2 hands, det/presence conf 0.3) + `blaze_face_short_range.tflite`, curled to `/root/` in the Modal image.

### 3.2 Stage 1.5 — Caching (`cache_dataset.py`, 110 lines)

`run_cache()` → `build_cache(split)` per split: `load_clip()` (RGB `ToTensor+Normalize`, flow `/30 clamp`, landmarks raw) → stacks all clips → `torch.save({frames,landmarks,labels,classes})` to `/data/cache/{training,validation,testing}.pt`. Skips existing `.pt`.

**Why this stage exists:** raw loading costs ~42,500 individual file reads per epoch (32 JPG + 2 NPY × ~1.3k clips). On Modal Volume (network FS) that is prohibitively slow; the single-`.pt` cache reduces epoch I/O to one sequential read. `modal_run.py::main()` (legacy) skips cache — use `pipeline()` instead.

### 3.3 Stage 2 — Loading (`fsl_datasets.py`, 204 lines)

- `CACHE_DIR = /data/cache` if `MODAL_RUN` else `./cache`. `load_dataset(root,split)` prefers `CACHE_DIR/split.pt` (`CachedFSLDataset`, on-the-fly augment) else raw `FSLDataset(root/split)`.
- RGB: ImageNet mean/std. Flow: `/FLOW_NORM_SCALE (30.0)`, clamp. Landmarks: wrist-relative norm per hand (subtract wrist joint per 21-pt hand) — applied in both dataset classes.
- Augment (train only): per-frame `ColorJitter(0.2,0.2,0.1)` on RGB, synced `±10°` rotation, 50% horizontal flip with `flow-dx negate + landmark-x negate + hand swap`. Kept geometrically consistent so mirrored signs stay valid.
- `collate_fn` stacks `(frames, landmarks, labels)`.

---

## 4. Training (`train_main.py`, 552 lines)

| Hyperparam | Value | Rationale |
|---|---|---|
| `CLASS_NAMES` / `NUM_CLASSES` | 5 greetings | Per-category training (see §6); greetings first because smallest clean dataset |
| `EPOCHS` / `FREEZE_EPOCHS` / `EARLY_STOP_PATIENCE` | 50 / 5 / 15 | 5 frozen epochs warm up LSTM+head on fixed ResNet features; unfreeze fine-tunes all; patience 15 (up from 7 in `juansignsrc`) tolerates plateau on small data |
| `BATCH_SIZE` / `UNFREEZE` | 16/6 Modal, 4/2 local | A10G 24GB fits 16×32×5×224×224; post-unfreeze drops to 6 for optimizer-state headroom; local 4/2 targets RTX 2070 8GB / CPU |
| `Adam(lr=1e-4)`, differential `visual 1e-6` on unfreeze | — | Prevents catastrophic forgetting of ImageNet features |
| `ReduceLROnPlateau(factor=0.5, patience=3)` | — | Standard plateau handling |
| `CrossEntropy(weight=class-balanced, label_smoothing=0.1)` | — | Counters uneven clip counts per greeting; smoothing absorbs annotator ambiguity |
| AMP `GradScaler`, `clip_grad_norm(5.0)`, `SEED=42`, `num_workers=2, persistent, pin_memory` | — | Stability + throughput |

**Evaluation suite (per new best + per epoch):** torchmetrics `MulticlassAccuracy/F1/Precision/Recall/ConfusionMatrix/CalibrationError`, sklearn `classification_report`, VRAM + LSTM gate stats every 5 epochs, gradient-flow checker (vanishing `<1e-7` / exploding `>100`), torchinfo (depth 4) + fvcore GFLOPs → `model_summary.txt`. Artifacts per run:

```
/data/models/juansign_v2_2.pth  # {model_state, class_names, num_classes}  ← NOTE: no epoch/val_acc keys
/data/results/{model_summary.txt, confusion_matrix.png, calibration_plot.png,
  training_curves.png, test_results.json, training_history.json}
/data/runs/v2_2_pilot/          # TensorBoard
/data/cache/*.pt  /data/processed_output/  (inputs, preserved)
```

Profiler (`profiler_report.txt`) runs **local-only** (`run_profiler and not IS_MODAL`, CUPTI OOM note) — so it will never appear in Modal results despite `download_result.py` requesting it.

**Checkpoint schema break:** old `juansignsrc/checkpoint.py` expects `ckpt['epoch','val_acc','val_loss']` but `train_main.py` saves only `model_state/class_names/num_classes` → `KeyError` on new checkpoints. **Reason:** new format optimized for inference deployment (labels travel with weights); training metrics moved to `test_results.json` / `training_history.json`. Old loader must be updated, not the checkpoint.

---

## 5. Modal Orchestration (`modal_run.py`, 218 lines)

```python
image = debian_slim(py3.11)
  .pip_install(torch==2.2.0, torchvision==0.17.0, opencv-headless, mediapipe,
    numpy==1.26.4, Pillow, tensorboard, scikit-learn, matplotlib, seaborn,
    torchmetrics, fvcore, torchinfo)   # NOTE: last 3 unpinned; missing from requirements.txt
  .apt_install(unzip, curl, libgl1, libglib2.0-0, libegl1-mesa, libgles2-mesa)
  .env(EGL_PLATFORM=surfaceless, MEDIAPIPE_DISABLE_GPU=1,
       PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True)
  .run_commands(curl hand_landmarker.task → /root/..., curl blaze_face... → /root/...)
  .add_local_dir("./", remote_path="/root")  # CWD-sensitive — must run from modal_training/
app = App("juansign-v2-2-training"); vol = Volume("juansign-model-vol")
```

| Remote fn | Resources | Guard | Job |
|---|---|---|---|
| `extract_on_cloud()` | cpu=4, mem=8GB, 3h | unzips `/data/.../dataset.zip` if `/data/unprocessed_input/training` missing | `run_extraction()` → `vol.commit()` |
| `cache_on_cloud()` | cpu=4, mem=16GB, 3h | requires `/data/processed_output` | `run_cache()` → `vol.commit()` |
| `train_on_cloud()` | gpu=A10G, 6h (raised from 2h — 50 epochs didn't fit) | requires `/data/processed_output` | `train()` try/except + `finally: vol.commit()` (preserves partial results on crash/timeout) |
| `pipeline_on_cloud()` | gpu=A10G, mem=16GB, 8h | requires `/data/processed_output`; skips cache if `training.pt` exists | cache→train, single commit — **recommended** |

Local entrypoints: `pipeline` (cache+train), `extract`, `cache`, `train`, `main` (legacy extract+train **without** cache — do not use). Invoke: `modal run --detach modal_run.py::pipeline` (from `modal_training/`).

**Why Modal + per-category models:** a single 7-category model exceeded both Modal's cost-effective GPU envelope and low-spec-device inference budgets. Per-category ResNet50+LSTM (~115MB each) trains in one A10G session and lets the frontend load only the active chapter's weights. Greetings (5 signs) was chosen as the pilot because it had the cleanest labeled clips.

---

## 6. Category & Weights Status

- **Trained scope (V2.2):** 5 greetings only. Extractor + trainer both hardcode this list.
- **Legacy registry (`juansignsrc/main.py:83-92 MODEL_REGISTRY`):** 8 keys — `alphabets, numbers, conversational_phrases, five_ws, greetings, days_of_week, adjectives_verbs, family` → `/model-weights/model/*.pth`.
- **Present locally (`category_models/`):** only `5whs.pth`, `days_of_week.pth`, `greetings.pth`. Missing 5 categories. Filename `5whs.pth` ≠ key `five_ws` → inference loader 400s on that category. **Reason:** only 3 datasets were clean enough to train; remaining 5 await data collection/cleaning. Naming drift came from dataset-folder naming (`5whs`) vs code slug (`five_ws`).
- **V2.2 output (`juansign_v2_2.pth`) vs legacy `greetings.pth`:** V2.2 is the successor for the greetings slot but lives on the **training** volume (`/data/models/`), while inference mounts a **different** volume path (`/model-weights/model/`). No script syncs them; promotion is manual (`modal volume get` → rename/backup → `modal volume put` to inference volume). No versioning scheme exists — overwriting `greetings.pth` without backup risks regression.

---

## 7. Gaps, Risks & Rationale

### 7.1 `requirements.txt` incomplete (HIGH)

10 pins; missing `torchmetrics`, `fvcore`, `torchinfo` (all imported at `train_main.py:20-30`). Local `pip install -r requirements.txt` → `ImportError`. **Why:** `requirements.txt` tracks the *local preprocessing* env; the Modal image (`modal_run.py:9-23`) is the true training env and does include the trio (unpinned). Fix: add the trio (pinned to Modal-resolved versions) or split `requirements-local.txt` / `requirements-modal.txt` and pin Modal image too (mediapipe/opencv/Pillow/matplotlib/seaborn/tensorboard/sklearn are currently unpinned on Modal vs pinned locally — future-breakage risk).

### 7.2 No local artifacts (HIGH — blocks integration)

`juansignmodel/` + `results/` empty; no `*.pt`, no `/data/results/*` pulled copy, no `dataset.zip`. **Why:** by design — artifacts live on the Modal Volume, and `download_result.py` was never run (it also omits the `.pth`). This is **not** evidence training failed; it is evidence no pull was performed. **Action:** `modal volume ls juansign-model-vol`, then extend `download_result.py` to fetch `models/juansign_v2_2.pth` + runs, and check in `test_results.json`/`training_history.json` summaries.

### 7.3 Stale files that look like progress but aren't (MEDIUM)

`colab_juansign.ipynb` (refs `ml-model/src/{data_splitter,frame_extractor,train}.py`, `processed_output/frame_extracted/{training_data,...}`, `ZIP_NAME='JuanSign_Thesis.zip'`, `GITHUB_URL='...YOUR_USERNAME...'`, "16 frames" vs current 32), `extraction_progress.txt` (A–E + `training_data/` naming vs current `training/` + greetings), `*.png` + `session_log.csv` (May/March pilot; 8–20% confidences = near-random debugger output, not V2.2 eval), `file_structure.json` (`fileanme` typo, unused), `envprocess.txt` (generic). **Why kept:** archaeological — team never ran a cleanup pass after migrating off Colab. **Action:** move to `ml-model/_archive/` or delete; rewrite or retire the notebook.

### 7.4 Train/infer preprocessing skew (HIGH for accuracy)

Training: face-only blur + hand-crop + pre-scan fallback + padding 50 + wrist-relative landmarks. Legacy inference (`juansignsrc/main.py::_extract_frames`): whole-frame `GaussianBlur`, padding 40, no face-anchor fallback, landmark dropout mismatch. **Why:** inference was written against the A–E pilot extractor and never updated for V2.2 dual-hand + anchor logic. Shipping V2.2 weights behind the old preprocessor will depress accuracy. Must reconcile before promotion; frontend should surface `top_predictions` + threshold UX, not single-label, until calibrated (legacy `CONFIDENCE_THRESHOLD=0.70` vs pilot reality 8–20%).

### 7.5 Silent class filtering + hardcoded paths (MEDIUM)

Extractor drops non-greeting folders silently; dual `IS_MODAL` pathing (`/data/...` vs `./...`) plus `.add_local_dir("./")` CWD sensitivity; inference paths (`/model-weights/model/*.pth`, `/hand_landmarker.task`, `/face_detector.tflite`) differ from training (`/root/...`, `blaze_face_short_range.tflite`). **Why:** hardcoded paths are the Modal-hybrid pattern (explicit > magic), and filtering guards label integrity — but each needs a loud log (`SKIP <folder>: not in CLASS_NAMES`) and a path-contract doc.

### 7.6 Missing export / contract (MEDIUM — blocks frontend)

No ONNX/TFLite export, no OpenAPI example, no checked-in `test_results.json`, no label-list contract asserting `checkpoint["class_names"] == frontend labels`. **Why:** training milestone stopped at `.pth` + TensorBoard; serving contract (Modal inference endpoint `juansign001--predict.modal.run`) was built against legacy weights. Frontend blocked on: final label list, confidence semantics, and latency/payload limits for video uploads.

---

## 8. Completeness Assessment

| Area | Status |
|---|---|
| Architecture + tensor contracts (`[B,32,5,224,224]` + `[B,32,126]`) | ✅ Fixed & documented in code |
| Extraction (face-blur, hand-crop, flow, 126-D, resume-safe) | ✅ Implemented |
| Caching (42.5k reads → 1) + smart loader + augments | ✅ Implemented |
| Training (AMP, balanced loss, freeze/unfreeze, early stop, torchmetrics, calibration, TensorBoard, FLOPs) | ✅ Implemented |
| Modal orchestration (volumes, GPU, timeouts, crash-safe commit) | ✅ Implemented |
| V2.2 greetings weights retrievable for integration | ❌ Unconfirmed (Volume state unknown, nothing pulled) |
| Inference parity + weight promotion + registry fix | ❌ Missing (old preprocessor, 5/8 categories absent, naming drift) |
| Packaging (requirements, download script, Colab, juansignsrc deprecation) | 🚧 Needs cleanup |
| Export (ONNX/TFLite) + serving contract + checked-in eval JSON | ❌ Missing |

**Next recommended actions (ml-only):** 1) `modal volume ls juansign-model-vol` + pull results (+ fix `download_result.py` to include `.pth`), 2) pin missing deps, 3) reconcile inference preprocessing with training, 4) promote `juansign_v2_2.pth` → versioned `greetings` slot + fix `five_ws` naming, 5) scope frontend to ready categories until 5 missing datasets land, 6) archive `juansignsrc/` + Colab + stale logs (keep `main.py` as inference reference after fix), 7) check in `test_results.json` summary + label contract.
