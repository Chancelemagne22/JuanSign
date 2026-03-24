# Copilot Instructions for JuanSign

This document helps Copilot and other AI assistants work effectively in the JuanSign repository.

## What is JuanSign?

JuanSign is a Filipino Sign Language (FSL) learning web application built as a thesis project. It uses a deep learning model (ResNet18 + LSTM) to recognize hand signs from webcam video in real time. The tech stack includes Next.js 14 frontend, Modal serverless GPU endpoints, and Supabase for authentication and data storage.

## Architecture Overview

**Three independent subsystems:**

1. **Frontend** (`front-end/`) — Next.js 14 app deployed on Vercel
   - Handles user auth via Supabase
   - Provides lesson viewing, practice recording, and assessment UI
   - Makes requests to the Next.js API route `/api/predict` with video + JWT
   - Fetches user progress and feedback from Supabase

2. **AI Inference** (`ml-model/main.py`) — Modal serverless GPU endpoint
   - No FastAPI; `@modal.web_endpoint` IS the API
   - Receives: base64-encoded video + JWT token
   - Returns: `{ sign: string, confidence: float }`
   - Writes prediction results to Supabase using `SUPABASE_SERVICE_ROLE_KEY`
   - Deployed to Modal via: `modal deploy ml-model/main.py`

3. **Database** (Supabase)
   - PostgreSQL with Row-Level Security (RLS) on all tables
   - Auth via Supabase Auth (email + password)
   - Key tables: `profiles`, `levels`, `lessons`, `practice_sessions`, `assessment_results`, `cnn_feedback`, `user_progress`

**Data Flow:**
```
Browser (JWT auth) → Next.js API route → Modal endpoint (verify JWT, process video, run model) 
→ Modal writes feedback to Supabase → React fetches updated progress
```

## Build, Test & Lint

### Frontend (Next.js 14)

```bash
cd front-end

# Install dependencies
npm install

# Development server (http://localhost:3000)
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Linting
npm run lint
```

> ESLint config: `eslint.config.mjs` (Next.js default)
> TypeScript strict mode is enabled: `tsconfig.json`

### ML Model (Python / PyTorch)

```bash
cd ml-model

# Activate virtual environment
# Windows:
.\venv\Scripts\Activate.ps1
# Mac/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Train the model (after frame extraction)
python ml-model/src/train.py

# Monitor with TensorBoard (real-time during training)
tensorboard --logdir ml-model/runs

# Single-image inference
python ml-model/src/predict_sign.py

# Live webcam inference (debugging)
python ml-model/src/realtime_inference.py
```

> The `train.py` script uses early stopping (5-epoch patience) and saves best checkpoint to `ml-model/juansignmodel/juansign_model.pth`

### Data Pipeline (Preprocessing)

```bash
cd ml-model

# 1. Split raw videos into train/val/test directories
python ml-model/src/data_splitter.py

# 2. Extract 16 frames per clip (hand detection via MediaPipe, face blurring for privacy)
python ml-model/src/frame_extractor.py

# Can be resumed if interrupted — checks `extraction_progress.txt`
```

> Alternatively, use the Windows batch script: `preprocess_classmate.bat` (one-click setup)

### Modal Deployment

```bash
# Install Modal
pip install modal

# Authenticate with Modal account
modal setup

# Create/update Modal secrets (must be named: juansign-secrets)
# Add: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

# Upload model weights to Modal Volume (one-time setup)
modal volume create juansign-model-vol
modal volume put juansign-model-vol ml-model/juansignmodel/juansign_model.pth /

# Deploy the endpoint
modal deploy ml-model/main.py

# Copy the returned Web URL into front-end/.env.local as MODAL_ENDPOINT_URL
```

## Environment Setup

### Frontend `.env.local` (server + browser)

```env
NEXT_PUBLIC_SUPABASE_URL=<Supabase project URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<Supabase anon key>
MODAL_ENDPOINT_URL=<Modal web endpoint URL>  # NOT prefixed NEXT_PUBLIC_
```

### Requirements

- **Node.js:** 22.14.0 (for frontend)
- **Python:** 3.11.x (for ML model)
- **npm:** 10.9.x

## Key Conventions and Rules

### Security & Secrets
- **NEVER** store passwords in custom Supabase tables (auth.users is the source of truth)
- **NEVER** use `SUPABASE_SERVICE_ROLE_KEY` in frontend code — Modal only
- **NEVER** commit `.env.local` to Git
- **NEVER** commit model weights (`.pth` files) — upload to Modal Volume instead

### Database (Supabase)
- All primary keys are UUID (`gen_random_uuid()`)
- Row-Level Security (RLS) must be enabled on ALL tables
- User data is linked via `auth_user_id` foreign key to `auth.users`
- `cnn_feedback` table is written to by Modal ONLY (not by frontend)

### Authentication
- JWT is issued on login via Supabase Auth
- Every Modal request must include the JWT token in the Authorization header
- JWT verification happens inside the Modal endpoint before any processing

### Frontend Code Structure
- Global CSS imports only in `app/layout.tsx` (Next.js convention)
- Supabase browser client is in `src/lib/supabase.ts` (uses @supabase/ssr)
- Components are organized by feature under `src/components/module/`
- TypeScript interfaces and type declarations in `src/types/`

### Git Workflow

Branches:
```
main                     ← stable releases
  └── dev                ← integration branch
        └── feature/<name>  ← working branches
```

**Do not commit:**
- `processed_output/` and `unprocessed_input/` — generated/raw videos (too large)
- `ml-model/venv/` — recreate with pip install
- `ml-model/juansignmodel/*.pth` — upload to Modal Volume
- `front-end/node_modules/` — recreate with npm install
- `.env.local` — never commit secrets

### Model Architecture

**Input:** 16 frames evenly sampled from a short video clip
**Pipeline:**
1. MediaPipe hand detection → crop hand region + pad
2. MediaPipe face detection → blur face for privacy
3. Resize each frame to 224×224, apply ImageNet normalization
4. ResNet18 feature extraction (512-dim per frame)
5. LSTM temporal modeling (256 hidden units across 16 frames)
6. Fully connected layer → softmax over 5 FSL sign classes (A, B, C, G, H)

**Output:** `{ sign: "A"|"B"|"C"|"G"|"H", confidence: 0.0–1.0 }`

### Next.js API Route Pattern

The Next.js API route at `front-end/app/api/predict/route.ts`:
- Acts as a proxy to the Modal endpoint
- Keeps the Modal URL server-side secret (prevents CORS issues)
- Receives: video (base64) + JWT from frontend
- Forwards to Modal with the JWT
- Returns Modal's response to frontend

### Supabase Table Overview

| Table | Purpose |
|-------|---------|
| `profiles` | Extends auth.users (username, name fields) |
| `levels` | Curriculum levels, sequential unlock via `previous_level_id` |
| `lessons` | Video content and metadata per level |
| `practice_questions` | Questions for practice mode per level |
| `assessment_questions` | Scored assessment questions per level |
| `practice_sessions` | Records practice activity: accuracy, duration, etc. |
| `assessment_results` | Scores, stars (0–3), pass/fail status |
| `cnn_feedback` | Model predictions + confidence + feedback message (Modal writes only) |
| `user_progress` | Per-user unlock state, best scores per level |

## Useful Debugging Commands

```bash
# Check if Modal endpoint is warm and responsive
curl -X POST https://<your-modal-endpoint>/api/predict \
  -H "Content-Type: application/json" \
  -d '{"test": "true"}'

# Check Supabase connection (frontend)
npm run dev  # Start dev server, check console for connection logs

# Verify JWT token structure (in browser console)
const token = localStorage.getItem('sb-token');
console.log(JSON.parse(atob(token.split('.')[1])));

# Monitor Frame Extraction Progress
cat ml-model/extraction_progress.txt

# View Modal logs (requires modal login)
modal logs ml_model.main
```

## Tips

- **Cold starts:** Modal endpoint uses `keep_warm=1` to avoid delays during active sessions
- **Preprocessing bottleneck:** Frame extraction is the longest step (O(videos × frames)). Can be run on a classmate's PC via `preprocess_classmate.bat`
- **TensorBoard:** Training progress is logged automatically; use `tensorboard --logdir ml-model/runs` to visualize in real time
- **GPU upgrade:** Production can use Modal's A10G GPU instead of T4 for faster inference (edit `main.py`)
