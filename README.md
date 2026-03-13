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
       ▼  (same-origin, no CORS)
  Next.js API Route  /api/predict   [front-end/app/api/predict/route.ts]
       │
       └─ server-to-server (no CORS)
            │
            ▼
  Modal Web Endpoint  ml-model/main.py  (GPU: T4)
       │  verify JWT via supabase.auth.get_user()
       │  preprocess frames (OpenCV + MediaPipe hand crop, 16 × 224×224)
       │  ResNet18 + LSTM inference (5-class FSL: A, B, C, G, H)
       │  write result → Supabase cnn_feedback (service role)
       └─ return { sign, confidence, is_correct, accuracy }
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
```

### Step 6 — Deactivate when done

```bash
deactivate
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
MODAL_ENDPOINT_URL=<your Modal deployed endpoint URL>
```

> - `MODAL_ENDPOINT_URL` has **no** `NEXT_PUBLIC_` prefix — it is server-only,
>   used only by the `/api/predict` proxy route, never exposed to the browser.
> - `SUPABASE_SERVICE_ROLE_KEY` is used by Modal only — never put it in the frontend.

---

## 3. Modal Endpoint Setup

The ML inference runs on Modal (serverless GPU). This must be set up before
the Upload Video button in Practice mode works.

### Step 1 — Install Modal CLI

```bash
pip install modal
modal setup   # authenticates your account
```

### Step 2 — Create Modal secrets (once)

In **Modal dashboard → Secrets → Create secret**, name it `juansign-secrets` and add:

```
SUPABASE_URL              = https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY = eyJ...   (from Supabase → Settings → API → service_role)
```

### Step 3 — Upload model weights to Modal Volume (once)

```bash
modal volume create juansign-model-vol
modal volume put juansign-model-vol ml-model/juansignmodel/juansign_model.pth /
```

Verify the upload:
```bash
modal volume ls juansign-model-vol
# should show: juansign_model.pth
```

### Step 4 — Deploy

```bash
modal deploy ml-model/main.py
```

### Step 5 — Get the endpoint URL

After deploy, go to **Modal dashboard → Apps → juansign → predict function**.
Copy the **Web URL** and paste it into `front-end/.env.local`:

```env
MODAL_ENDPOINT_URL=https://your-workspace--juansign-juansigninference-predict.modal.run
```

> ⚠️ **Known issue:** If you used `@modal.asgi_app` at any point, the function
> label in the dashboard may show as **"asgi"** instead of **"predict"**.
> The fix is to redeploy with `@modal.fastapi_endpoint(label="predict")` (already
> done in the current `main.py`). After redeploying, look for the function
> labelled **"predict"** — it will have the correct URL.

Then restart the dev server:
```bash
cd front-end && npm run dev
```

---

## 4. Data Preparation Pipeline

Run these steps in order from the **repo root** before training.

### Step 1 — Organize raw clips into train / test / val splits

Place raw video files in `processed_output/raw_data/<letter>/` then run:

```bash
python ml-model/src/data_splitter.py
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

## 5. Training

Activate the venv and run from `ml-model/src/`:

```bash
cd ml-model/src
python train.py
```

- Trains `ResNetLSTM` (ResNet18 backbone + LSTM head)
- Classes derived from `sorted(os.listdir())` on training data folder
- Best checkpoint saved to `ml-model/juansignmodel/juansign_model.pth`
- After retraining, re-upload weights to Modal Volume (Step 3 above)

### Watch training live with TensorBoard

```bash
tensorboard --logdir ml-model/runs
# Open http://localhost:6006
```

---

## 6. Inference and Visualization

All scripts run from `ml-model/src/` with the venv activated.

```bash
python predict_sign.py        # predict the sign in one processed clip folder
python model_visualization.py # confusion matrix + classification report
python forward_pass_viz.py    # 7-stage pipeline visualization
python gradcam.py             # Grad-CAM saliency on a single frame
python realtime_inference.py  # live webcam inference
python analyze_video.py       # analyze a video file
python clip_to_video.py       # convert extracted frames back to video
```

---

## 7. Known Issues & Debugging Log

This section documents errors encountered during development and their resolutions.

### Modal endpoint class count mismatch
**Error:** `RuntimeError: size mismatch for fc.weight: shape [5, 256] vs [27, 256]`
**Cause:** `CLASS_NAMES` in `main.py` was set to all 27 FSL letters, but the saved
`juansign_model.pth` was trained on only 5 classes (A, B, C, G, H).
**Fix:** Set `CLASS_NAMES = ["A", "B", "C", "G", "H"]` in `main.py` to match the
actual checkpoint. When the model is retrained on all 27 classes, update this list
and re-upload the weights to the Modal Volume.

### Modal JWT verification failure
**Error:** `Invalid token: 'SUPABASE_URL'` / `Invalid token: Supabase JWT SECRET`
**Cause 1:** Modal secrets were named with `NEXT_PUBLIC_` prefix (e.g.
`NEXT_PUBLIC_SUPABASE_URL`) instead of `SUPABASE_URL`.
**Cause 2:** Attempted manual JWT verification with `PyJWT` using the wrong secret format.
**Fix:** Rename secrets in Modal dashboard to `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. Use `supabase.auth.get_user(token)` instead of
PyJWT — it validates the token server-side with no JWT secret needed.

### CORS blocked by browser
**Error:** `Access to fetch blocked by CORS policy: No 'Access-Control-Allow-Origin' header`
**Cause:** The browser was POSTing directly to the Modal endpoint. Modal's
`@modal.fastapi_endpoint` does not add CORS headers by default.
**Fix:** Added a Next.js API proxy route at `front-end/app/api/predict/route.ts`.
The browser POSTs to `/api/predict` (same origin), the server forwards to Modal
(server-to-server, no CORS needed). `MODAL_ENDPOINT_URL` is now server-only
(no `NEXT_PUBLIC_` prefix).

### Modal ASGI app returns NoneType error
**Error:** `internal error: status Failure: TypeError("'NoneType' object is not callable")`
**Cause:** Switched from `@modal.fastapi_endpoint` to `@modal.asgi_app` on a
`@app.cls` instance method — this combination is not properly supported by Modal.
The ASGI decorator on a class method returns `None` internally.
**Fix:** Reverted to `@modal.fastapi_endpoint(method="POST", label="predict")`.
CORS is handled by the Next.js proxy, so Modal no longer needs CORS headers.

### Modal dashboard shows "asgi" label instead of "predict"
**Cause:** Previously deployed with `@modal.asgi_app(label="predict")` which
registered the endpoint under a different internal name.
**Status:** After redeploying with `@modal.fastapi_endpoint(label="predict")`,
the correct "predict" label should reappear. If the dashboard still shows "asgi",
check under **Apps → juansign** for any function with a Web URL — that is the
endpoint URL regardless of label name.

### Modal returns non-JSON plain text
**Error:** `SyntaxError: Unexpected token 'm', "modal-http"... is not valid JSON`
**Cause:** Modal gateway errors return plain text, not JSON. The `/api/predict`
route called `.json()` unconditionally.
**Fix:** Check `Content-Type` header before parsing. If not JSON, return a 502
with the raw text so the error is visible in the server logs.

---

## 8. Git Workflow

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

### Committing

```bash
git add front-end/app/dashboard/page.tsx
git commit -m "feat: add paginated dashboard with level lock/unlock state"
```

**Commit message format:**

```
<type>: <what and why>
Types: feat | fix | refactor | docs | chore
```

### Files to never commit

| Path | Reason |
|---|---|
| `processed_output/` | Large extracted frames — generated locally |
| `unprocessed_input/` | Raw videos — too large for git |
| `ml-model/venv/` | Virtual environment — recreated with pip |
| `ml-model/juansignmodel/*.pth` | Model weights ~48 MB — gitignored |
| `front-end/node_modules/` | Dependencies — recreated with npm install |
| `.env.local` | Secrets — never commit |

---

## Project Structure

```
JuanSign/
├── ml-model/
│   ├── main.py                          ← Modal endpoint (deploy this)
│   ├── src/
│   │   ├── resnet_lstm_architecture.py  ← model definition (ResNet18 + LSTM)
│   │   ├── train.py                     ← training loop
│   │   ├── fsl_dataset.py               ← FSLDataset loader (16 frames per clip)
│   │   ├── frame_extractor.py           ← video → 16 frames (MediaPipe hand/face)
│   │   ├── data_splitter.py             ← train / test / val split
│   │   ├── predict_sign.py              ← single-clip inference
│   │   ├── forward_pass_viz.py          ← 7-stage pipeline visualization
│   │   ├── gradcam.py                   ← Grad-CAM saliency maps
│   │   ├── model_visualization.py       ← confusion matrix + report
│   │   ├── realtime_inference.py        ← live webcam inference
│   │   └── analyze_video.py             ← per-video analysis
│   └── juansignmodel/                   ← juansign_model.pth (gitignored)
│
├── front-end/                           ← Next.js 14 (App Router)
│   ├── app/
│   │   ├── api/predict/route.ts         ← server proxy → Modal (avoids CORS)
│   │   ├── layout.tsx                   ← root layout, global fonts
│   │   ├── page.tsx                     ← welcome / auth entry point
│   │   └── dashboard/
│   │       ├── page.tsx                 ← main dashboard
│   │       ├── lessons/[lessonId]/      ← lesson video player
│   │       ├── practice/[chapterId]/    ← webcam recorder + ML upload
│   │       └── assessment/[chapterId]/  ← assessment (placeholder)
│   ├── components/
│   │   └── module/
│   │       ├── LessonView.tsx           ← demo video player
│   │       ├── PracticeView.tsx         ← webcam recorder + result overlay
│   │       └── AssessmentView.tsx       ← assessment placeholder
│   ├── lib/supabase.ts                  ← browser Supabase client
│   └── .env.local                       ← secrets (never commit)
│
└── README.md
```
