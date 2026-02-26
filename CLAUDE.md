# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is JuanSign

Thesis project: Filipino Sign Language (FSL) recognition system. Classifies hand signs (A, B, C, G, H) from video clips using a ResNet18+LSTM hybrid model. Three modules: ML training pipeline, a Node.js backend (stub), and a Next.js frontend (stub).

## Tech Stack

| Layer | Technology |
|---|---|
| ML | Python 3.11.5, PyTorch 2.10.0, OpenCV, scikit-learn, MediaPipe |
| Frontend | Next.js 16.1.6, React 19.2.3, TypeScript 5, Tailwind CSS 4 |
| Backend | Node.js (template only, no implementation yet) |

## Key Directories

| Path | Purpose |
|---|---|
| `ml-model/src/` | All training, inference, and visualization scripts |
| `ml-model/juansignmodel/` | Saved model weights (`juansign_model.pth`, ~48 MB, gitignored) |
| `processed_output/` | Extracted frames organized by split/class/clip (gitignored) |
| `unprocessed_input/` | Raw video files input to frame extractor (gitignored) |
| `front-end/app/` | Next.js App Router pages and layout |
| `back-end/` | Node.js API server (stub only) |

## Build & Run Commands

### ML Model
All scripts run from `ml-model/src/` inside the virtual environment.

```bash
# Environment setup (one-time, from ml-model/)
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install torch torchvision opencv-python pillow scikit-learn matplotlib seaborn mediapipe

# Frame extraction — run from repo root
python ml-model/src/frame_extractor.py

# Training
cd ml-model/src && python train.py

# Inference on a single clip folder
cd ml-model/src && python predict_sign.py

# Model evaluation and visualizations
cd ml-model/src && python model_visualization.py
cd ml-model/src && python train_val_visuals.py

# Check GPU availability
cd ml-model && python check.py
```

### Frontend
```bash
cd front-end
npm install      # Node v22.14.0 required
npm run dev      # localhost:3000
npm run build
npm run lint
```

## Core Data Flow

```
unprocessed_input/<letter>/<video.mp4>
  → frame_extractor.py   →  processed_output/<split>/<letter>/clip001/frame0000.jpg
  → fsl_dataset.py       →  FSLDataset (PyTorch Dataset, with augmentation)
  → train.py             →  ResNetLSTM model → juansign_model.pth
  → predict_sign.py      →  (predicted_class, confidence_score)
```

## Critical Configuration Constants

These are hardcoded and must stay consistent across files — see `.claude/docs/architectural_patterns.md`:
- Frame count: **16** (`frame_extractor.py:8` `TARGET_FRAMES`, `predict_sign.py:28`)
- Image size: **224×224** (`frame_extractor.py:9` `TARGET_SIZE`, `fsl_dataset.py:14`)
- Classes: **["A","B","C","G","H"]** (alphabetical = label indices 0–4)
- ImageNet normalization: `mean=[0.485,0.456,0.406]`, `std=[0.229,0.224,0.225]`

## Git Workflow

Feature branches off `dev` → PR to `dev` → merge to `main`. Branch naming: `feature/<description>`.

## Additional Documentation

| File | When to check |
|---|---|
| `.claude/docs/architectural_patterns.md` | Modifying any ML script; adding inference or training logic |
