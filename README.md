# JuanSign

**JuanSign** is a Filipino Sign Language (FSL) learning web application built as a 4th-year thesis project. It guides learners through a structured **lesson → practice → assessment** cycle, using a deep learning model to recognize hand signs from short webcam recordings in real time.

---

## What It Does

1. **Watch** — A lesson video demonstrates the correct hand shape for each FSL letter.
2. **Practice** — The learner records themselves signing via webcam. The video is sent to a GPU-powered model that identifies the sign and returns a confidence score.
3. **Assess** — A scored assessment unlocks the next level in the curriculum.

Currently trained on **5 FSL letters: A, B, C, G, H**, with the architecture ready to scale to the full alphabet.

---

## How the AI Works

A **ResNet18 + LSTM** model processes short video clips:

```
Webcam recording (webm)
  ↓
Sample 16 frames evenly across the clip
  ↓
MediaPipe — detect hand region (21 landmarks), crop + pad
MediaPipe — blur face for signer privacy
  ↓
Resize each frame to 224 × 224, ImageNet normalization
  ↓
ResNet18 — extract spatial features per frame (512-dim)
LSTM      — model motion across 16 frames (256 hidden units)
FC layer  — classify into 5 FSL signs
  ↓
{ sign: "B", confidence: 94.3%, is_correct: true }
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), Tailwind CSS — deployed on Vercel |
| AI Backend | Modal (serverless GPU endpoint, T4) |
| Database & Auth | Supabase (Postgres + RLS + Auth) |
| ML Framework | PyTorch (ResNet18 + LSTM) |
| Computer Vision | OpenCV, MediaPipe |

---

## System Architecture

```
Browser (Vercel)
  │
  ├─ Supabase Auth  →  JWT on login
  ├─ Supabase DB    →  levels, lessons, progress, sessions, feedback
  ├─ Supabase Storage → lesson demo videos
  │
  └─ POST /api/predict  (video base64 + JWT)
       │
       ▼  Next.js API Route  [avoids CORS, keeps Modal URL server-side]
       │
       ▼  Modal Web Endpoint  ml-model/main.py  (GPU: T4)
            verify JWT → extract frames → run model → write feedback → return result
```

---

## Project Structure

```
JuanSign/
├── ml-model/
│   ├── main.py                          ← Modal GPU endpoint (deploy this)
│   └── src/
│       ├── resnet_lstm_architecture.py  ← model definition
│       ├── train.py                     ← training loop
│       ├── fsl_dataset.py               ← dataset loader (16 frames/clip)
│       ├── frame_extractor.py           ← video → frames (MediaPipe crop + blur)
│       ├── data_splitter.py             ← train / val / test split
│       ├── predict_sign.py              ← single-clip inference
│       ├── realtime_inference.py        ← live webcam inference
│       ├── model_visualization.py       ← confusion matrix + report
│       ├── gradcam.py                   ← Grad-CAM saliency maps
│       └── analyze_video.py             ← per-video analysis
│
├── front-end/                           ← Next.js 14 (App Router)
│   ├── app/
│   │   ├── api/predict/route.ts         ← server proxy → Modal
│   │   ├── page.tsx                     ← auth entry point
│   │   └── dashboard/
│   │       ├── page.tsx                 ← main dashboard
│   │       ├── lessons/[lessonId]/      ← lesson video player
│   │       ├── practice/[chapterId]/    ← webcam recorder + ML upload
│   │       └── assessment/[chapterId]/  ← assessment
│   ├── components/module/
│   │   ├── LessonView.tsx
│   │   ├── PracticeView.tsx
│   │   └── AssessmentView.tsx
│   └── lib/supabase.ts                  ← Supabase browser client
│
└── README.md
```

---

## Local Setup

### Requirements

| Tool | Version |
|---|---|
| Node.js | 22.14.0 |
| Python | 3.11.x |
| npm | 10.9.x |

---

### Frontend

```bash
cd front-end
npm install
npm run dev        # http://localhost:3000
```

Create `front-end/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=<your Supabase project URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your Supabase anon key>
MODAL_ENDPOINT_URL=<your Modal endpoint URL>   # server-only, no NEXT_PUBLIC_ prefix
```

---

### ML Model (Python)

```bash
cd ml-model
python -m venv venv

# Windows
.\venv\Scripts\Activate.ps1

# Mac / Linux
source venv/bin/activate

pip install torch torchvision opencv-python pillow scikit-learn matplotlib seaborn mediapipe tensorboard
```

---

### Modal GPU Endpoint

```bash
pip install modal
modal setup

# Create secrets in Modal dashboard (name: juansign-secrets)
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY

# Upload model weights (once)
modal volume create juansign-model-vol
modal volume put juansign-model-vol ml-model/juansignmodel/juansign_model.pth /

# Deploy
modal deploy ml-model/main.py
```

Copy the deployed Web URL into `MODAL_ENDPOINT_URL` in `.env.local`.

---

### Training (optional)

```bash
# 1. Split raw videos into train/val/test
python ml-model/src/data_splitter.py

# 2. Extract 16 frames per clip (hand crop + face blur)
python ml-model/src/frame_extractor.py

# 3. Train
cd ml-model/src
python train.py

# Monitor with TensorBoard
tensorboard --logdir ml-model/runs
```

---

## Database (Supabase)

Key tables:

| Table | Purpose |
|---|---|
| `profiles` | Extends auth.users — name, username |
| `levels` | Curriculum levels with sequential unlock |
| `lessons` | Video content per level |
| `practice_sessions` | Records each practice attempt + accuracy |
| `assessment_results` | Score, stars (0–3), pass/fail |
| `cnn_feedback` | Model prediction + feedback message |
| `user_progress` | Per-user unlock state and best scores |

Row-Level Security (RLS) is enabled on all tables. Passwords are never stored in custom tables.

---

## Git Workflow

```
main                        ← stable releases
  └── dev                   ← integration branch
        └── feature/<name>  ← working branches
```

**Do not commit:**
- `processed_output/` — generated frames (too large)
- `unprocessed_input/` — raw videos (too large)
- `ml-model/venv/` — recreate with pip
- `ml-model/juansignmodel/*.pth` — upload to Modal Volume instead
- `front-end/node_modules/` — recreate with npm install
- `.env.local` — never commit secrets

---

## Thesis Context

JuanSign is a 4th-year Computer Science thesis project. It demonstrates the application of deep learning and computer vision for assistive and educational technology — specifically for Filipino Sign Language recognition — with a full-stack deployment pipeline targeting real classroom use.
