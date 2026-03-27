# JuanSign Codebase — Comprehensive Analysis Report

## Executive Summary

**JuanSign** is a full-stack Filipino Sign Language (FSL) learning platform that combines deep learning, computer vision, and web technologies to teach FSL through interactive lessons, practice, and assessment. Students record themselves signing via webcam, and a ResNet18+LSTM model running on GPU recognizes the sign and provides real-time feedback.

---

## 1. PROJECT OVERVIEW

### What JuanSign Does
1. **Watch** — Lesson videos demonstrate correct hand shapes for FSL letters
2. **Practice** — Learners record themselves signing via webcam; the model identifies the sign with a confidence score
3. **Assess** — Scored assessments unlock the next curriculum level
4. **Track Progress** — Dashboard shows completion status, best scores, and stars earned

### Current Scope
- **Trained on:** 5 FSL letters (A, B, C, G, H)
- **Architecture:** Ready to scale to full alphabet
- **Status:** Production-ready with deployment to Vercel and Modal

---

## 2. TECHNOLOGY STACK

| Layer | Technology | Details |
|---|---|---|
| **Frontend** | Next.js 14 (App Router) | Server components, client components, API routes |
| | React 19 | UI components and state management |
| | Tailwind CSS 4 | Responsive styling |
| | TypeScript 5 | Type-safe development |
| | Deployment | Vercel (serverless) |
| **AI Backend** | Modal | Serverless GPU endpoint (T4, upgradeable to A10G) |
| | PyTorch 2.2.0 | Deep learning framework |
| **Database & Auth** | Supabase (PostgreSQL) | Database, authentication, real-time updates |
| | Supabase Auth | Email + password authentication with JWT |
| | Row-Level Security (RLS) | Fine-grained data access control |
| **Computer Vision** | MediaPipe 0.10.11 | Hand pose detection (21 landmarks per hand) |
| | OpenCV | Frame extraction, hand cropping, face blurring |
| | PyTorch TorchVision 0.17.0 | Pre-trained ResNet18 backbone |
| **ML Framework** | ResNet18 + LSTM | Spatial feature extraction + temporal modeling |

---

## 3. SYSTEM ARCHITECTURE

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Browser (Vercel)                            │
│  - Next.js 14 Frontend                                          │
│  - React UI Components                                          │
│  - TailwindCSS Styling                                          │
└──────────┬──────────────────────────────────────────┬───────────┘
           │                                          │
           │ 1. Email/Password                        │ 3. Fetch Levels,
           │ 2. JWT on Login                          │    Lessons, Progress
           │                                          │
    ┌──────▼──────────────────────────────────────────▼──────┐
    │          Supabase (PostgreSQL + Auth)                   │
    │  - Authentication: email + password JWT                 │
    │  - Tables: profiles, levels, lessons, practice_sessions │
    │           assessment_results, cnn_feedback, user_progress
    │  - RLS enabled on ALL tables                            │
    │  - JWT verification on every request                    │
    └────────────────────────┬────────────────────────────────┘
                             │
                             │ 4. GET lessons/results
                             │
    ┌────────────────────────▼────────────────────────────────┐
    │    Next.js API Route                                    │
    │    /api/predict (server-side proxy)                     │
    │    - Accepts: video (base64) + JWT token               │
    │    - Sends to Modal (keeps Modal URL server-side)       │
    └────────────────────────┬────────────────────────────────┘
                             │
                             │ 5. POST video (base64) + JWT
                             │
    ┌────────────────────────▼────────────────────────────────┐
    │    Modal Web Endpoint (GPU: T4)                         │
    │    ml-model/main.py                                     │
    │    - JWT verification                                   │
    │    - Frame extraction (MediaPipe)                       │
    │    - Hand detection + face blur                         │
    │    - ResNet18 + LSTM inference                          │
    │    - Write results to Supabase (service role key)       │
    │    - Return { sign, confidence } to frontend            │
    └────────────────────────┬────────────────────────────────┘
                             │
                             │ 6. Result { sign, confidence }
                             │
    ┌────────────────────────▼────────────────────────────────┐
    │    React (Frontend)                                     │
    │    - Display prediction result                          │
    │    - Show feedback message                              │
    │    - Update user progress on dashboard                  │
    └─────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

1. **Modal for AI Processing** — Serverless GPU endpoint means no server maintenance
2. **Next.js API Route Proxy** — Hides Modal URL from client, prevents CORS issues
3. **JWT Authentication** — Sent with every Modal request, verified on GPU
4. **Supabase Service Role Key** — Only Modal uses it to write results back to DB
5. **RLS on All Tables** — Ensures users only access their own data
6. **MediaPipe for Hand Detection** — Real-time, privacy-friendly, no server-side training needed

---

## 4. PROJECT FOLDER STRUCTURE

```
Thesis/
├── front-end/                      ← Next.js 14 Application
│   ├── app/
│   │   ├── page.tsx                ← Auth entry point (login/signup)
│   │   ├── reset-password.tsx      ← Password reset flow
│   │   ├── layout.tsx              ← Root layout, global CSS import
│   │   ├── api/
│   │   │   └── predict/
│   │   │       └── route.ts        ← Server proxy to Modal endpoint
│   │   ├── admin/
│   │   │   ├── (auth)/login/       ← Admin login
│   │   │   └── (protected)/
│   │   │       ├── page.tsx        ← Admin dashboard
│   │   │       ├── users/          ← User management
│   │   │       ├── levels/         ← Level management
│   │   │       ├── settings/       ← System settings
│   │   │       └── reports/        ← Analytics/reports
│   │   └── dashboard/
│   │       ├── page.tsx            ← Student main dashboard
│   │       ├── layout.tsx          ← Dashboard layout with navigation
│   │       ├── lessons/
│   │       │   ├── page.tsx        ← Lessons list
│   │       │   └── [lessonId]/     ← Lesson video player
│   │       ├── practice/
│   │       │   ├── page.tsx        ← Practice module list
│   │       │   └── [chapterId]/    ← Webcam recorder + ML upload
│   │       └── assessment/
│   │           ├── page.tsx        ← Assessment list
│   │           └── [chapterId]/    ← Assessment quiz interface
│   │
│   ├── components/
│   │   ├── module/                 ← Reusable course modules
│   │   │   ├── LessonView.tsx      ← Video player component
│   │   │   ├── PracticeView.tsx    ← Webcam recorder + ML inference UI
│   │   │   └── AssessmentView.tsx  ← Quiz interface component
│   │   └── [other components]      ← Navigation, forms, etc.
│   │
│   ├── lib/
│   │   └── supabase.ts             ← Supabase browser client (SSR setup)
│   │
│   ├── styles/
│   │   └── globals.css             ← Global Tailwind styles
│   │
│   ├── types/
│   │   └── declarations.d.ts       ← TypeScript interface definitions
│   │
│   ├── middleware.ts               ← Next.js middleware for auth checks
│   ├── package.json                ← Frontend dependencies
│   ├── tsconfig.json               ← TypeScript config
│   ├── tailwind.config.ts          ← Tailwind customization
│   ├── next.config.ts              ← Next.js configuration
│   └── .env.local                  ← Environment variables (not committed)
│
├── ml-model/                       ← Machine Learning Training & Inference
│   ├── main.py                     ← Modal web_endpoint for GPU deployment
│   ├── src/
│   │   ├── resnet_lstm_architecture.py   ← Model definition (ResNet18 + LSTM)
│   │   ├── train.py                      ← Training loop with early stopping
│   │   ├── fsl_dataset.py                ← PyTorch Dataset loader
│   │   ├── frame_extractor.py            ← Video → 16 frames per clip
│   │   │                                    (MediaPipe hand crop + face blur)
│   │   ├── data_splitter.py              ← Train/val/test split logic
│   │   ├── predict_sign.py               ← Single-clip inference
│   │   ├── realtime_inference.py         ← Live webcam inference
│   │   ├── model_visualization.py        ← Confusion matrix + metrics
│   │   ├── gradcam.py                    ← Grad-CAM saliency visualizations
│   │   └── analyze_video.py              ← Per-video analysis tool
│   │
│   ├── juansignmodel/
│   │   └── juansign_model.pth            ← Pre-trained model weights (513 MB)
│   │
│   ├── colab_juansign.ipynb              ← Google Colab notebook for training
│   ├── requirements.txt                  ← Python dependencies
│   ├── envprocess.txt                    ← Environment setup notes
│   ├── TRAINING_GUIDE.md                 ← How to train the model
│   │
│   ├── processed_output/                 ← Generated frame data
│   │   ├── raw_data/                     ← Original videos (organized by letter)
│   │   ├── frame_extracted/
│   │   │   ├── training_data/<letter>/clipXXX/frame0000.jpg...frame0015.jpg
│   │   │   ├── validation_data/
│   │   │   └── testing_data/
│   │   └── [various outputs]
│   │
│   ├── unprocessed_input/                ← Split videos (train/val/test)
│   ├── gradcam_videos/                   ← Saliency map visualizations
│   ├── model_visual/                     ← Confusion matrices and metrics
│   └── runs/                             ← TensorBoard logs
│
├── back-end/
│   └── template.js                       ← (Placeholder or legacy)
│
├── Documentation Files (Markdown)
│   ├── README.md                         ← Main project overview
│   ├── CLAUDE.md                         ← AI assistant context doc
│   ├── SETUP_GUIDE.md                    ← Local setup instructions
│   ├── TRAINING_GUIDE.md                 ← ML training workflow
│   ├── SUPABASE_EMAIL_GUIDE.md          ← Email configuration
│   ├── PASSWORD_FEATURES_SUMMARY.md      ← Change password feature overview
│   ├── CHANGE_PASSWORD_*.md              ← Change password implementation docs
│   ├── FORGOT_PASSWORD_*.md              ← Forgot password feature docs
│   ├── RESPONSIVE_DESIGN_*.md            ← Responsive design docs
│   └── [Other docs]
│
└── Configuration & Utilities
    ├── preprocess_classmate.bat          ← One-click preprocessing script
    ├── setup_copilot_dir.py              ← Copilot directory setup
    ├── .gitignore                        ← Git ignore rules
    └── .git/                             ← Git repository
```

---

## 5. FRONTEND (Next.js 14)

### Architecture
- **Framework:** Next.js 14 with App Router
- **Styling:** Tailwind CSS 4
- **Rendering:** Mix of Server Components and Client Components
- **Authentication:** Supabase Auth + JWT

### Key Pages & Routes

| Route | Component | Purpose |
|---|---|---|
| `/` | `page.tsx` | **Login/Signup** — Auth entry point |
| `/reset-password` | `reset-password.tsx` | **Password Recovery** — Reset flow |
| `/dashboard` | `dashboard/page.tsx` | **Main Dashboard** — Shows levels, lessons, progress |
| `/dashboard/lessons` | `lessons/page.tsx` | **Lessons List** — View all available lessons |
| `/dashboard/lessons/[lessonId]` | `[lessonId]/page.tsx` | **Lesson Video** — Watch FSL letter demo |
| `/dashboard/practice` | `practice/page.tsx` | **Practice List** — Select practice module |
| `/dashboard/practice/[chapterId]` | `[chapterId]/page.tsx` | **Practice Webcam** — Record sign, submit to ML |
| `/dashboard/assessment` | `assessment/page.tsx` | **Assessment List** — Available quizzes |
| `/dashboard/assessment/[chapterId]` | `[chapterId]/page.tsx` | **Assessment Quiz** — Scored exam |
| `/admin/login` | `admin/(auth)/login/page.tsx` | **Admin Login** — Admin authentication |
| `/admin` | `admin/(protected)/page.tsx` | **Admin Dashboard** — System overview |
| `/admin/users` | `admin/(protected)/users/page.tsx` | **User Management** — List/manage students |
| `/admin/levels` | `admin/(protected)/levels/page.tsx` | **Level Management** — Create/edit curriculum |
| `/admin/settings` | `admin/(protected)/settings/page.tsx` | **System Settings** — Configuration |
| `/admin/reports` | `admin/(protected)/reports/page.tsx` | **Analytics** — Usage statistics |

### Key Components

**Under `components/module/`:**
- **LessonView.tsx** — Video player for lesson demonstrations
- **PracticeView.tsx** — Webcam recorder, ML submission, result display
- **AssessmentView.tsx** — Quiz interface with score calculation

### Environment Variables (`.env.local`)
```env
NEXT_PUBLIC_SUPABASE_URL          → Supabase project URL (public, safe)
NEXT_PUBLIC_SUPABASE_ANON_KEY     → Supabase anonymous key (public, safe)
NEXT_PUBLIC_MODAL_ENDPOINT_URL    → Modal web endpoint URL (public, safe)
SUPABASE_SERVICE_ROLE_KEY         → Service role key (server-only, never client!)
MODAL_ENDPOINT_URL                → Modal URL for server proxy (no NEXT_PUBLIC_)
```

### Authentication Flow
1. User enters email + password on `/` (login or signup)
2. Supabase Auth validates credentials and issues JWT
3. JWT is stored in secure browser storage (via Supabase SSR)
4. On page navigation, middleware checks JWT validity
5. Protected pages redirect unauthenticated users to `/`
6. Every API call includes JWT in Authorization header
7. Modal endpoint verifies JWT before processing

### API Routes
- **`/api/predict`** — Server proxy that:
  - Accepts video (base64) + JWT
  - Forwards to Modal endpoint
  - Returns `{ sign, confidence, feedback }`
  - Handles errors and logging

---

## 6. ML MODEL & AI BACKEND

### Model Architecture

**ResNet18 + LSTM**

```
Input: Video clip (up to ~3 seconds)
  ↓
[1] Extract 16 frames evenly across the clip
  ↓
[2] MediaPipe Hand Detection
    - Detect 21 hand landmarks per frame
    - Crop bounding box around hand
    - Pad to square (224 × 224)
    - Blur face for privacy
  ↓
[3] Preprocessing
    - Resize to 224 × 224
    - ImageNet normalization
    - Convert to tensor
  ↓
[4] ResNet18 (frozen backbone)
    - Extract spatial features per frame
    - Output: 512-dimensional vector per frame
  ↓
[5] LSTM Layer
    - Process 16 sequential vectors
    - Model temporal motion patterns
    - Hidden units: 256
    - Output: 256-dimensional context vector
  ↓
[6] Fully Connected Classifier
    - Input: 256-dim vector
    - Output: 5 class logits (A, B, C, G, H)
  ↓
Result: { sign: "B", confidence: 94.3%, is_correct: true }
```

### Key Files

| File | Purpose |
|---|---|
| `main.py` | Modal web_endpoint—receives video + JWT, runs inference, writes to Supabase |
| `resnet_lstm_architecture.py` | Model class definition (ResNet18 backbone + LSTM + FC) |
| `train.py` | Training loop—data loading, forward pass, backprop, early stopping |
| `fsl_dataset.py` | PyTorch Dataset—loads 16-frame clips, applies augmentation |
| `frame_extractor.py` | Video processing—extracts 16 frames, hand detection, face blur |
| `data_splitter.py` | Splits raw videos into train/val/test sets |
| `predict_sign.py` | Inference on single clip (returns sign + confidence) |
| `realtime_inference.py` | Live webcam demo (for local testing) |
| `model_visualization.py` | Generates confusion matrix + classification report |
| `gradcam.py` | Grad-CAM saliency maps for model interpretability |
| `analyze_video.py` | Analyzes per-video performance |

### Training Data

**Currently:**
- **5 Signs:** A, B, C, G, H (each with ~100+ labeled video clips)
- **Split:** 90% training, 12% testing, rest validation
- **Frames:** 16 frames per clip (evenly sampled)

**Data Organization:**
```
processed_output/
├── raw_data/
│   ├── A/ (100+ .mp4 files)
│   ├── B/
│   ├── C/
│   ├── G/
│   └── H/
└── frame_extracted/
    ├── training_data/
    │   ├── A/clip001/frame0000.jpg...frame0015.jpg
    │   ├── B/clip002/...
    │   └── ...
    ├── validation_data/
    └── testing_data/
```

### Modal Deployment

**File:** `ml-model/main.py`

```python
# Pseudo-code structure:
@modal.web_endpoint(keep_warm=1)
def predict(request):
    video_base64 = request["video"]
    jwt_token = request["jwt"]
    
    # 1. Verify JWT with Supabase
    user_id = verify_jwt(jwt_token)
    
    # 2. Decode video and extract frames
    frames = extract_frames(video_base64)
    
    # 3. Run model inference
    sign, confidence = model(frames)
    
    # 4. Write feedback to Supabase (using service role key)
    write_feedback(user_id, sign, confidence, feedback_message)
    
    # 5. Return result to frontend
    return {
        "sign": sign,
        "confidence": confidence,
        "feedback": feedback_message
    }
```

**Deployment Steps:**
```bash
# 1. Create Modal secrets (name: juansign-secrets)
# - SUPABASE_URL
# - SUPABASE_SERVICE_ROLE_KEY

# 2. Upload model weights to Modal Volume
modal volume create juansign-model-vol
modal volume put juansign-model-vol ml-model/juansignmodel/juansign_model.pth /

# 3. Deploy the endpoint
modal deploy ml-model/main.py

# 4. Copy the Web URL to NEXT_PUBLIC_MODAL_ENDPOINT_URL in .env.local
```

**GPU:** T4 (can upgrade to A10G for faster inference)
**Keep Warm:** 1 (avoids cold start delays during active use)

---

## 7. DATABASE (Supabase PostgreSQL)

### Authentication

- **Provider:** Supabase Auth (email + password)
- **JWT:** Issued on login, stored in browser
- **RLS:** All tables have RLS enabled
- **User Creation:** Auto-creates profile on auth.users insert via trigger

### Core Tables

#### `profiles`
Extends auth.users with additional user metadata.
```sql
CREATE TABLE profiles (
    id UUID PRIMARY KEY (REFERENCES auth.users(id)),
    username VARCHAR(100) UNIQUE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    avatar_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### `levels`
Curriculum levels with sequential unlocking.
```sql
CREATE TABLE levels (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    order_index INT,
    previous_level_id UUID (REFERENCES levels(id)),  -- NULL for first level
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### `lessons`
Video content and materials per level.
```sql
CREATE TABLE lessons (
    id UUID PRIMARY KEY,
    level_id UUID NOT NULL (REFERENCES levels(id)),
    title VARCHAR(255),
    description TEXT,
    video_url TEXT,  -- stored in Supabase Storage
    content_text TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### `practice_questions`
Practice exercises with ML reference data.
```sql
CREATE TABLE practice_questions (
    id UUID PRIMARY KEY,
    level_id UUID NOT NULL (REFERENCES levels(id)),
    sign_letter CHAR(1),  -- 'A', 'B', 'C', 'G', 'H'
    description TEXT,
    reference_data JSONB,  -- landmark data for comparison
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### `assessment_questions`
Scored exam questions.
```sql
CREATE TABLE assessment_questions (
    id UUID PRIMARY KEY,
    level_id UUID NOT NULL (REFERENCES levels(id)),
    sign_letter CHAR(1),
    question_text TEXT,
    points INT DEFAULT 10,
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### `practice_sessions`
Records user practice activity.
```sql
CREATE TABLE practice_sessions (
    id UUID PRIMARY KEY,
    auth_user_id UUID NOT NULL (REFERENCES auth.users(id)),
    level_id UUID NOT NULL (REFERENCES levels(id)),
    question_id UUID (REFERENCES practice_questions(id)),
    video_url TEXT,  -- stored in Supabase Storage
    sign_recorded CHAR(1),
    is_correct BOOLEAN,
    average_accuracy FLOAT,  -- 0.0 to 1.0
    timestamp TIMESTAMP DEFAULT NOW()
);
```

#### `assessment_results`
Exam scores and progress.
```sql
CREATE TABLE assessment_results (
    id UUID PRIMARY KEY,
    auth_user_id UUID NOT NULL (REFERENCES auth.users(id)),
    level_id UUID NOT NULL (REFERENCES levels(id)),
    score INT,  -- 0 to 100
    stars_earned INT,  -- 0, 1, 2, or 3
    time_taken_seconds INT,
    is_passed BOOLEAN,  -- TRUE if score >= passing threshold
    attempted_at TIMESTAMP DEFAULT NOW()
);
```

#### `cnn_feedback`
ML model predictions and feedback.
```sql
CREATE TABLE cnn_feedback (
    id UUID PRIMARY KEY,
    auth_user_id UUID NOT NULL (REFERENCES auth.users(id)),
    session_id UUID (REFERENCES practice_sessions(id)),
    result_id UUID (REFERENCES assessment_results(id)),
    predicted_sign CHAR(1),
    accuracy_score FLOAT,  -- 0.0 to 1.0
    feedback_message TEXT,  -- "Good job! Try faster." etc.
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### `user_progress`
Aggregated progress per user per level.
```sql
CREATE TABLE user_progress (
    id UUID PRIMARY KEY,
    auth_user_id UUID NOT NULL (REFERENCES auth.users(id)),
    level_id UUID NOT NULL (REFERENCES levels(id)),
    is_unlocked BOOLEAN DEFAULT FALSE,
    lessons_completed INT DEFAULT 0,
    best_score INT DEFAULT 0,
    total_practice_sessions INT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(auth_user_id, level_id)
);
```

### Security & RLS Policies

**All tables have RLS enabled. Example policies:**

```sql
-- Users can only read/write their own data
ALTER TABLE practice_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own practice sessions"
ON practice_sessions FOR SELECT
USING (auth_user_id = auth.uid());

CREATE POLICY "Users can insert own practice sessions"
ON practice_sessions FOR INSERT
WITH CHECK (auth_user_id = auth.uid());

-- Admin can read all data
CREATE POLICY "Admin can read all"
ON practice_sessions FOR SELECT
USING (is_admin(auth.uid()));  -- Custom function
```

### Storage

- **Lesson Videos:** `storage/lessons/{level_id}/{lesson_id}.mp4`
- **Practice Recordings:** `storage/practice/{user_id}/{session_id}.webm`
- **Model:** Uploaded to Modal Volume (not Supabase Storage)

---

## 8. AUTHENTICATION & SECURITY

### Authentication Flow

1. **Sign Up**
   - User enters email + password
   - Supabase Auth creates account in `auth.users`
   - Trigger auto-creates entry in `profiles` table
   - JWT issued

2. **Login**
   - User enters email + password
   - Supabase Auth validates
   - JWT issued and stored securely

3. **Protected Pages**
   - Next.js middleware checks JWT on every request
   - Redirects to `/` if invalid or expired
   - JWT refreshed automatically (via Supabase SSR)

4. **API Calls**
   - Every request includes JWT in `Authorization: Bearer {JWT}`
   - Supabase validates signature server-side
   - Row-Level Security (RLS) filters data

5. **Modal Requests**
   - Frontend calls `/api/predict` (server proxy)
   - Server proxy extracts JWT, forwards to Modal
   - Modal verifies JWT with Supabase
   - Modal only processes if JWT valid
   - Modal uses service role key to write results (not frontend key!)

### Security Best Practices Implemented

| Practice | Implementation |
|---|---|
| **Secrets** | Never committed to Git; stored in `.env.local` (client) and Modal secrets dashboard (server) |
| **Service Role Key** | Only used by Modal backend, NEVER in frontend code |
| **JWT Verification** | Required on every Modal request before processing |
| **RLS** | Enabled on ALL Supabase tables; users only access their own data |
| **Face Blurring** | MediaPipe blurs signer's face before sending frames to model (privacy) |
| **No Password Storage** | Custom tables never store passwords; Supabase Auth handles all auth |
| **HTTPS Only** | Vercel (frontend) and Modal (backend) both enforce HTTPS |
| **CORS** | Avoided by using Next.js server proxy; Modal endpoint not exposed to client |

---

## 9. FEATURES & WORKFLOWS

### Student Workflow

1. **Sign Up / Login**
   - Enter email + password
   - Redirected to `/dashboard`

2. **Browse Curriculum**
   - View available levels (locked/unlocked)
   - See lessons per level (with locked indicators)

3. **Watch Lesson**
   - Click lesson → video player with description
   - Learn hand shapes for FSL letter

4. **Practice**
   - Record video of self signing (via webcam)
   - Submit to model (video sent to Modal endpoint)
   - Model returns: sign (letter), confidence, feedback
   - Session saved to `practice_sessions` table
   - Feedback displayed on screen

5. **Assessment**
   - Attempt scored exam (10 points per question)
   - Record video of each sign
   - Submit → model predicts → score calculated
   - Stars earned: 0-3 (based on score threshold)
   - Result saved to `assessment_results` table
   - If passed → unlock next level (update `user_progress`)

6. **Track Progress**
   - Dashboard shows:
     - Levels completed (with star ratings)
     - Best score per level
     - Total practice sessions
     - Estimated time to finish

### Admin Workflow

1. **Login** → `/admin/login`
2. **Dashboard** → Overview of system stats
3. **User Management** → List, edit, deactivate students
4. **Level Management** → Create/edit/delete curriculum levels
5. **Settings** → System-wide configuration
6. **Reports** → Analytics (usage, performance trends)

---

## 10. DEPLOYMENT

### Frontend (Vercel)

1. Connect GitHub repo to Vercel
2. Set environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_MODAL_ENDPOINT_URL`
3. Deploy branch → automatic build & deploy

### Backend (Modal)

1. Ensure Modal secrets created (juansign-secrets):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

2. Upload model weights:
   ```bash
   modal volume create juansign-model-vol
   modal volume put juansign-model-vol ml-model/juansignmodel/juansign_model.pth /
   ```

3. Deploy:
   ```bash
   modal deploy ml-model/main.py
   ```

4. Copy Web URL to Vercel `.env.local` as `NEXT_PUBLIC_MODAL_ENDPOINT_URL`

### Database (Supabase)

1. Create PostgreSQL project on Supabase dashboard
2. Run SQL migrations to create tables (with RLS enabled)
3. Configure Auth: email/password provider
4. Set up Storage buckets (lessons, practice_recordings)

---

## 11. DEVELOPMENT SETUP

### Requirements
- **Node.js** 22.14.0
- **npm** 10.9.x
- **Python** 3.11.x
- **Git** 2.x

### Frontend Setup
```bash
cd front-end
npm install
npm run dev  # http://localhost:3000
```

### ML Model Setup
```bash
cd ml-model
python -m venv venv

# Windows
.\venv\Scripts\Activate.ps1

# Mac/Linux
source venv/bin/activate

pip install -r requirements.txt
```

### Training
```bash
# 1. Split raw videos
python ml-model/src/data_splitter.py

# 2. Extract frames
python ml-model/src/frame_extractor.py

# 3. Train model
cd ml-model/src
python train.py

# Monitor training
tensorboard --logdir ml-model/runs
```

### One-Click Preprocessing (Windows)
```bash
# Just double-click preprocess_classmate.bat
# It will:
# - Create virtual environment
# - Install packages
# - Split videos
# - Extract frames
# - Resume from last checkpoint if interrupted
```

---

## 12. KEY FILES & THEIR ROLES

| File | Purpose | Language |
|---|---|---|
| `front-end/app/page.tsx` | Login/signup entry point | TypeScript/React |
| `front-end/app/dashboard/page.tsx` | Main student dashboard | TypeScript/React |
| `front-end/app/api/predict/route.ts` | Server proxy to Modal | TypeScript |
| `front-end/lib/supabase.ts` | Supabase client (SSR) | TypeScript |
| `front-end/middleware.ts` | Auth middleware | TypeScript |
| `ml-model/main.py` | Modal GPU endpoint | Python |
| `ml-model/src/resnet_lstm_architecture.py` | Model class definition | Python |
| `ml-model/src/train.py` | Training loop | Python |
| `ml-model/src/frame_extractor.py` | Video → frames | Python |
| `ml-model/colab_juansign.ipynb` | Google Colab training notebook | Jupyter |
| `README.md` | Main project overview | Markdown |
| `SETUP_GUIDE.md` | Setup instructions | Markdown |
| `CLAUDE.md` | AI assistant context | Markdown |

---

## 13. WORKFLOW & GIT BRANCHING

**Branch Strategy:**
```
main                  ← Stable releases
  └── dev            ← Integration branch
        └── feature/<name>  ← Working branches
```

**Do NOT commit:**
- `processed_output/` — too large (generated frames)
- `unprocessed_input/` — too large (raw videos)
- `ml-model/venv/` — recreate with `pip install`
- `ml-model/juansignmodel/*.pth` — upload to Modal Volume
- `front-end/node_modules/` — recreate with `npm install`
- `.env.local` — NEVER commit secrets!

---

## 14. RECENT FEATURES ADDED

Based on documentation files found:

### Password Management
- **Change Password** — Authenticated users can change their password
- **Forgot Password** — Email-based password reset link
- **Password Reset Flow** — Secure token-based reset

### Responsive Design
- Fully responsive UI using Tailwind CSS
- Mobile-first design approach
- Touch-friendly interface for webcam recording

### Email Integration
- Supabase email provider configured
- Welcome emails on signup
- Password reset emails

---

## 15. SYSTEM CAPABILITIES & LIMITS

| Capability | Details |
|---|---|
| **Users** | Unlimited students can register |
| **Levels** | Currently 5 signs (A, B, C, G, H); architecture supports expansion to 26 |
| **Practice Sessions** | Unlimited per user; stored in DB |
| **Video Recording** | Up to 3 seconds per attempt (optimal for model) |
| **Model Inference** | ~2-3 seconds per video (on T4 GPU) |
| **Concurrent Users** | Modal keeps 1 instance warm; scales up on demand |
| **Model Accuracy** | ~94-95% on trained 5-letter set (from architecture description) |
| **Database Size** | PostgreSQL scales; no hard limits for typical classroom (100-1000 users) |

---

## 16. TESTING & QUALITY

### Available Tools
- **ESLint** — Frontend linting
- **TypeScript** — Type checking
- **TensorBoard** — ML training monitoring
- **Confusion Matrix** — Model evaluation

### What Can Be Tested
- Model accuracy on test set (5 signs)
- Inference speed (should be < 5s per video)
- Frontend responsiveness (Tailwind breakpoints)
- Auth flows (signup, login, password reset)
- RLS policies (ensure data isolation)

---

## 17. KNOWN ISSUES & CONSIDERATIONS

1. **Cold Start Delay** — First Modal request after idle might take 10-15s (mitigated by `keep_warm=1`)
2. **5-Letter Limitation** — Currently only A, B, C, G, H; full alphabet requires retraining
3. **Video Length** — Expects ~1-3 second clips; longer videos may have degraded accuracy
4. **Hand Occlusion** — Model struggles if hand is partially hidden or against background
5. **Lighting Conditions** — Poor lighting can affect MediaPipe hand detection
6. **Privacy Consideration** — Although face is blurred, hand identity could theoretically be tracked

---

## 18. FUTURE ROADMAP (Implied)

- **Expand to Full Alphabet** — Train on 26 FSL letters
- **Phrase Recognition** — Recognize sequences of signs (not just individual letters)
- **Classroom Analytics** — Better reporting for teachers
- **Offline Mode** — Cache lessons for offline access
- **Mobile App** — Native iOS/Android apps
- **Accessibility Features** — Closed captions, sign language interpretation

---

## 19. CONCLUSION

**JuanSign** is a comprehensive, production-ready full-stack application demonstrating:
- **Deep Learning** — ResNet18 + LSTM for video understanding
- **Real-Time Processing** — GPU-powered inference on Modal
- **Web Technology** — Next.js 14 with modern React patterns
- **Database Design** — PostgreSQL with RLS for security
- **Deployment** — Vercel + Modal + Supabase integration

The architecture is scalable, secure, and ready to expand from 5 letters to the full FSL alphabet. The codebase follows best practices for authentication, data privacy, and user experience.

---

*Generated: 2026-03-26*
