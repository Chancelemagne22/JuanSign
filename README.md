# JuanSign

A Filipino Sign Language learning platform with AI-powered sign recognition. Students can practice and get assessed on sign language through a web app, while a ResNet50 + LSTM model classifies signs in real-time.

## Project Structure

```
├── front-end/          # Next.js 16 web application
│   ├── app/            # Pages and API routes
│   ├── components/     # React components
│   ├── context/        # React contexts (i18n, etc.)
│   ├── hooks/          # Custom hooks
│   ├── lib/            # Utility libraries
│   ├── i18n/           # Internationalization
│   ├── styles/         # CSS files
│   └── types/          # TypeScript types
│
├── ml-model/           # Machine learning code
│   ├── modal_training/ # Training pipeline (Modal cloud + local)
│   └── requirements.txt
│
└── README.md
```

## Prerequisites

- **Node.js** 18+ (for front-end)
- **Python** 3.11+ (for ML model)
- **Supabase** account (database + auth)
- **Modal** account (optional, for cloud GPU training)

---

## Front-End Setup

### 1. Install Dependencies

```bash
cd front-end
npm install
```

### 2. Environment Variables

Create `front-end/.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Database Setup

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** in the Supabase dashboard
3. Run the main schema first:

   ```sql
   -- Run: juansign_database.sql
   -- Creates all core tables with RLS policies:
   --   - profiles, levels, lessons
   --   - practice_questions, assessment_questions
   --   - practice_sessions, assessment_results
   --   - lessons_viewed, user_progress, admin_invites, signs
   ```

4. Run the admin setup script:

   ```sql
   -- Run: front-end/supabase/SETUP_ADMIN_INVITES.sql
   -- Creates admin invite system and RPC functions
   ```


> **Note:** The main schema (`juansign_database.sql`) includes Row Level Security (RLS) policies. Make sure your Supabase project has auth enabled.

### 4. Run Development Server

```bash
cd front-end
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## ML Model Setup

The platform covers 7 categories of Filipino Sign Language:
- **Alphabets** — FSL alphabet signs
- **Numbers** — Number signs
- **Greetings** — Good morning, good afternoon, etc.
- **Days of the Week** — Day signs
- **Conversational Phrases** — Common phrases
- **5 Ws** — Who, What, When, Where, Why
- **Adjectives/Verbs** — Descriptive and action signs

The ML model uses a **ResNet50 + LSTM** architecture to classify FSL gestures. Models are trained per category due to hardware constraints — Modal's GPU instances and low-spec devices cannot handle a single large multi-category model. The current model supports the **greetings** category (5 signs: good_afternoon, good_evening, good_midday, good_morning, good_night). To add a new category, train a separate model with that category's dataset.

### 1. Install Python Dependencies

```bash
cd ml-model
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Install Modal CLI

```bash
pip install modal
modal setup  # Authenticate with your Modal account
```

### 3. Prepare Dataset

Place your dataset in `ml-model/unprocessed_input/` with this structure:

```
unprocessed_input/
├── training/
│   ├── A/  (video clips for class A)
│   ├── B/
│   └── ...
├── testing/
└── validation/
```

### 4. Upload Dataset to Modal

```bash
cd ml-model/modal_training

# Upload dataset zip to Modal Volume
modal volume put juansign-model-vol ./dataset.zip /dataset.zip
```

### 5. Run Training Pipeline

```bash
cd ml-model/modal_training

# Full pipeline: extract frames + cache + train (recommended)
modal run --detach modal_run.py::pipeline

# Or run steps individually:
modal run --detach modal_run.py::extract   # Frame extraction
modal run --detach modal_run.py::cache     # Cache dataset
modal run --detach modal_run.py::train     # Training only
```

### 6. Download Results

```bash
# Download trained model
modal volume get juansign-model-vol models/juansign_v2_2.pth ./juansignmodel/juansign_v2_2.pth

# Download training results
modal volume get juansign-model-vol results ./results
modal volume get juansign-model-vol runs ./runs
```

Training outputs:
- Model weights: `juansignmodel/juansign_v2_2.pth`
- TensorBoard logs: `runs/`
- Results: `results/`

---

## API Integration

The front-end communicates with the ML model via the `/api/predict` endpoint. To connect your trained model:

1. Place the `.pth` file in `front-end/public/models/` (or serve it via Supabase Storage)
2. Update the prediction API route in `front-end/app/api/predict/route.ts`

---

## Available Scripts

### Front-End

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run i18n:check` | Check i18n translation parity |

### ML Model (Modal)

| Command | Description |
|---------|-------------|
| `modal run --detach modal_run.py::pipeline` | Full pipeline (extract + cache + train) |
| `modal run --detach modal_run.py::extract` | Frame extraction only |
| `modal run --detach modal_run.py::cache` | Dataset caching only |
| `modal run --detach modal_run.py::train` | Training only |

---

## Tech Stack

- **Front-End**: Next.js 16, React 19, TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Auth)
- **ML**: PyTorch, ResNet50, LSTM, MediaPipe
- **Cloud Training**: Modal (GPU: A10G)

---

## License

[Add your license here]
