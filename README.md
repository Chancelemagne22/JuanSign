# JuanSign — Filipino Sign Language Learning App

A web application that teaches Filipino Sign Language (FSL) through a structured
lesson → practice → assessment cycle. A ResNet18 + LSTM model recognizes signs
from short webcam recordings in real time.

---

## Architecture

```
Browser (Vercel — Next.js 14)
  │
  ├─ Supabase Auth  →  issues JWT on login
  │
  ├─ Supabase DB    →  levels, lessons, user_progress, practice_sessions,
  │                    assessment_results, cnn_feedback   (Postgres + RLS)
  │
  ├─ Supabase Storage → lesson demo videos (public bucket: lesson-videos)
  │
  └─ POST video (base64) + JWT
       │
       ▼
  Modal Web Endpoint (GPU: T4)
       │  verify JWT
       │  preprocess frames (OpenCV, 16 × 224×224)
       │  ResNet18 + LSTM inference (27-class FSL)
       │  write result → Supabase (service role)
       └─ return { sign, confidence }
```

### Learning Cycle (per level)

```
Dashboard  →  [letter 0] LessonView  →  PracticeView  →
              [letter 1] LessonView  →  PracticeView  →  …  →  AssessmentView
```

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Python | 3.11.5 | ML model only |
| Node.js | 22.14.0 | Frontend only |
| npm | 10.9.2 | Comes with Node |
| GPU (optional) | CUDA-capable | CPU works but training is slow |

```bash
python --version    # should print Python 3.11.x
node --version      # should print v22.14.0
npm --version       # should print 10.9.x
```

---

## 1. ML Model Setup

All ML scripts live in `ml-model/src/` and must be run inside a Python virtual
environment.

> **Do this once** when you first clone the repo.

### Step 1 — Create the virtual environment

```bash
cd ml-model
python -m venv venv
```

### Step 2 — Activate the virtual environment

**Windows — PowerShell**
```powershell
.\venv\Scripts\Activate.ps1
```

**Windows — Command Prompt (CMD)**
```cmd
.\venv\Scripts\activate.bat
```

**Mac / Linux**
```bash
source venv/bin/activate
```

Your prompt will show `(venv)` when activated.

> **PowerShell error — "running scripts is disabled"?**
> ```powershell
> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```

### Step 3 — Upgrade pip

```bash
python -m pip install --upgrade pip
```

### Step 4 — Install packages

```bash
pip install torch torchvision opencv-python pillow scikit-learn matplotlib seaborn mediapipe tensorboard
```

> **GPU / CUDA:** The command above installs the CPU-only build. For NVIDIA GPU:
> 1. Run `nvidia-smi` to find your CUDA version
> 2. Go to **https://pytorch.org/get-started/locally/** and copy the generated command
> 3. Run that instead of the command above

### Step 5 — Verify installation

```bash
python -c "import torch; print('PyTorch:', torch.__version__)"
python -c "import cv2; print('OpenCV:', cv2.__version__)"
python -c "import mediapipe; print('MediaPipe:', mediapipe.__version__)"

# From ml-model/ (one level up from src/)
python check.py
```

### Step 6 — Deactivate when done

```bash
deactivate
```

### Package reference

| Package | pip name | Used by |
|---|---|---|
| PyTorch | `torch` `torchvision` | all ML scripts |
| OpenCV | `opencv-python` | `frame_extractor.py`, `gradcam.py` |
| Pillow | `pillow` | `fsl_dataset.py`, `predict_sign.py`, `gradcam.py` |
| scikit-learn | `scikit-learn` | `model_visualization.py` (confusion matrix) |
| Matplotlib | `matplotlib` | all visualization scripts |
| Seaborn | `seaborn` | `model_visualization.py` |
| MediaPipe | `mediapipe` | `frame_extractor.py` (hand + face detection) |
| TensorBoard | `tensorboard` | `train.py` (live loss/accuracy curves) |

### Quick-start checklist (every session)

```
[ ] Open terminal inside ml-model/
[ ] Run activation command for your OS  (see Step 2)
[ ] Confirm (venv) appears in the prompt
[ ] cd into ml-model/src/ before running any script
```

---

## 2. Frontend Setup

```bash
cd front-end
npm install
npm run dev      # starts dev server at http://localhost:3000
```

Other commands:

```bash
npm run build    # production build
npm run lint     # ESLint check
```

### Environment variables

Create `front-end/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=<your Supabase project URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your Supabase anon key>
NEXT_PUBLIC_MODAL_ENDPOINT_URL=<your Modal deployed endpoint URL>
```

> `SUPABASE_SERVICE_ROLE_KEY` is used by Modal only — never put it in the frontend.

---

## 3. Data Preparation Pipeline

Run these steps in order from the **repo root** before training.

### Step 1 — Organize raw clips into train / test / val splits

Place raw video files in `processed_output/raw_data/<letter>/` then run:

```bash
python ml-model/src/data_splitter.py
```

Output:

```
unprocessed_input/
  training_data/<letter>/      ← 100 clips per letter
  testing_data/<letter>/       ← 12 clips per letter
  validation_data/<letter>/    ← remaining clips
```

### Step 2 — Extract frames from each video clip

```bash
python ml-model/src/frame_extractor.py
```

Reads from `unprocessed_input/` and writes 16 frames per clip to:

```
processed_output/frame_extracted/
  training_data/<letter>/clip001/frame0000.jpg … frame0015.jpg
  testing_data/<letter>/clip001/
  validation_data/<letter>/clip001/
```

> `frame_extractor.py` anonymizes faces with Gaussian blur and crops to the
> detected hand region using the MediaPipe Task API. Downloads
> `hand_landmarker.task` automatically on first run.

---

## 4. Training

Activate the venv and run from `ml-model/src/`:

```bash
cd ml-model/src
python train.py
```

What happens:

- Loads data via `FSLDataset` (16 frames × 224×224, ImageNet normalization)
- Trains `ResNetLSTM` (ResNet18 backbone + LSTM head, **27 FSL classes**)
- ResNet18 frozen for first 10 epochs, then fully unfrozen for fine-tuning
- `ReduceLROnPlateau` halves LR when val loss stalls for 3 epochs
- Best checkpoint saved to `ml-model/juansignmodel/juansign_model.pth`
- Early stopping after 5 epochs with no val loss improvement
- Final test evaluation runs automatically on the best checkpoint

### Watch training live with TensorBoard

```bash
# Second terminal, from repo root
tensorboard --logdir ml-model/runs
# Open http://localhost:6006
```

---

## 5. Inference and Visualization

All scripts run from `ml-model/src/` with the venv activated.

```bash
# Predict the sign in one processed clip folder
python predict_sign.py

# Confusion matrix and classification report on the test set
python model_visualization.py

# Full 7-stage forward pass visualization (raw input → Grad-CAM → classification)
python forward_pass_viz.py

# Grad-CAM saliency on a single frame
python gradcam.py

# Live webcam inference
python realtime_inference.py

# Analyze a video file
python analyze_video.py

# Convert extracted frames back into a video clip
python clip_to_video.py
```

---

## 6. Git Workflow — How to Commit

### Branch structure

```
main                        ← stable releases only
  └── dev                   ← integration branch (PRs merge here)
        └── feature/<name>  ← your working branch
```

### Starting a new feature

```bash
git checkout dev
git pull origin dev
git checkout -b feature/your-feature-name
```

### Committing your changes

```bash
# Stage specific files (preferred)
git add front-end/app/dashboard/page.tsx
git add ml-model/src/train.py

# Commit with a clear message
git commit -m "feat: add paginated dashboard with level lock/unlock state"
```

**Commit message format:**

```
<type>: <what and why>

Types: feat | fix | refactor | docs | chore

Examples:
  feat: add webcam recorder and ML upload stub to PracticeView
  fix: resolve FileNotFoundError on training start due to wrong dataset path
  docs: update README architecture to reflect Supabase + Modal stack
```

### Pushing and creating a Pull Request

```bash
git push origin feature/your-feature-name
```

Then on GitHub:
1. Click **"Compare & pull request"**
2. Set **base: dev** ← compare: `feature/your-feature-name`
3. Write a short description and submit

### Syncing after a merge

```bash
git checkout dev
git pull origin dev
git branch -d feature/your-feature-name
```

### Files to never commit

| Path | Reason |
|---|---|
| `processed_output/` | Large extracted frames — generated locally |
| `unprocessed_input/` | Raw videos — too large for git |
| `raw_data/` | Source clips — gitignored |
| `ml-model/venv/` | Virtual environment — recreated with pip |
| `ml-model/juansignmodel/*.pth` | Model weights ~48 MB — gitignored |
| `front-end/node_modules/` | Dependencies — recreated with npm install |
| `.env.local` | Secrets — never commit |

---

## Project Structure

```
JuanSign/
├── ml-model/
│   ├── src/
│   │   ├── resnet_lstm_architecture.py  ← model definition (ResNet18 + LSTM, 27 classes)
│   │   ├── train.py                     ← training loop with early stopping + TensorBoard
│   │   ├── fsl_dataset.py               ← FSLDataset loader (16 frames per clip)
│   │   ├── frame_extractor.py           ← video → 16 frames (MediaPipe hand/face)
│   │   ├── data_splitter.py             ← train / test / val split
│   │   ├── predict_sign.py              ← single-clip inference
│   │   ├── forward_pass_viz.py          ← 7-stage pipeline visualization
│   │   ├── gradcam.py                   ← Grad-CAM saliency maps
│   │   ├── model_visualization.py       ← confusion matrix + classification report
│   │   ├── realtime_inference.py        ← live webcam inference
│   │   ├── analyze_video.py             ← per-video analysis
│   │   ├── clip_to_video.py             ← frames → video clip
│   │   └── model.py                     ← load weights for standalone inference
│   └── juansignmodel/                   ← juansign_model.pth (gitignored)
│
├── front-end/                           ← Next.js 14 (App Router)
│   ├── app/
│   │   ├── layout.tsx                   ← root layout, global fonts
│   │   ├── page.tsx                     ← welcome screen (auth entry point)
│   │   └── dashboard/
│   │       ├── page.tsx                 ← lesson selection grid (paginated, lock/unlock)
│   │       └── lessons/[lessonId]/
│   │           └── page.tsx             ← module controller (lesson → practice → assessment)
│   ├── components/
│   │   ├── module/
│   │   │   ├── LessonView.tsx           ← demo video player (play/pause/restart/stop)
│   │   │   ├── PracticeView.tsx         ← webcam recorder + ML upload stub
│   │   │   └── AssessmentView.tsx       ← assessment placeholder
│   │   ├── lessons/LessonCard.tsx       ← card with lock overlay
│   │   ├── chapter/ChapterTemplate.tsx
│   │   ├── welcome/WelcomePage.tsx
│   │   ├── login/LoginModal.tsx         ← Supabase email/password login
│   │   ├── signup/SignupModal.tsx        ← Supabase registration
│   │   └── profile/UserProfileModal.tsx ← post-auth profile display
│   ├── lib/
│   │   └── supabase.ts                  ← createBrowserClient (@supabase/ssr)
│   ├── types/
│   │   └── user.ts                      ← UserData interface
│   └── styles/                          ← global CSS
│
└── README.md
```
