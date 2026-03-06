# JuanSign — Project Context for Claude Code

## What is JuanSign?
A Filipino Sign Language (FSL) learning web application.
Students practice and get assessed on FSL gestures via webcam.
A CNN-ResNet-LSTM model recognizes the signs in real time.

## Stack
- **Frontend:** Next.js 14 (App Router) — deployed on Vercel
- **AI Backend:** Modal (serverless GPU endpoint, no FastAPI)
- **Database:** Supabase (Postgres + Auth)
- **Styling:** Tailwind CSS

---

## Architecture

```
React (Vercel)
  ↓ Supabase Auth → JWT issued
  ↓ POST video + JWT
Modal Web Endpoint (GPU: T4)
  ↓ Verify JWT
  ↓ Preprocess frames (OpenCV)
  ↓ Run CNN-ResNet-LSTM model
  ↓ Write result to Supabase (service role)
  ↓ Return { sign, confidence } to React
React displays result + fetches updated progress from Supabase
```

---

## Supabase

### Auth
- Provider: Supabase Auth (email + password)
- JWT is issued on login and sent with every Modal request
- Profiles are auto-created via trigger on auth.users insert

### Tables
- `profiles` — extends auth.users (username, first_name, last_name, is_active)
- `levels` — curriculum levels with sequential unlocking (previous_level_id)
- `lessons` — video + content per level
- `practice_questions` — per level, includes reference_data for CNN
- `assessment_questions` — per level, includes points
- `practice_sessions` — records user practice activity + average_accuracy
- `assessment_results` — score, stars_earned (0-3), time_taken_seconds, is_passed
- `cnn_feedback` — accuracy_score + feedback_message, linked to session or result
- `user_progress` — tracks is_unlocked, lessons_completed, best_score per level

### Rules
- All PKs are UUID (gen_random_uuid())
- RLS is enabled on ALL tables
- Passwords are never stored in custom tables
- `auth_user_id` is the FK used to link all user data to auth.users

---

## Modal

- No FastAPI — Modal web_endpoint IS the API
- Deployed via: `modal deploy main.py`
- Endpoint receives: video (base64) + JWT token
- Endpoint returns: `{ sign: string, confidence: float }`
- Modal writes prediction results to Supabase using SUPABASE_SERVICE_ROLE_KEY
- GPU: T4 (can upgrade to A10G)
- keep_warm=1 to avoid cold starts during active sessions

---

## Folder Structure
```
src/
  app/          → Next.js App Router pages and layouts
  components/   → Reusable UI components
  lib/          → supabase.ts client, utilities
  styles/       → globals.css
  types/        → declarations.d.ts, typescript interfaces
main.py         → Modal deployment file (in project root)
CLAUDE.md       → This file
```

## Supabase Client Location
`src/lib/supabase.ts` — browser client using @supabase/ssr

## Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL          → Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY     → Safe to expose to client
SUPABASE_SERVICE_ROLE_KEY         → Modal only, NEVER in frontend
NEXT_PUBLIC_MODAL_ENDPOINT_URL    → Modal deployed endpoint URL
```

---

## Key Rules
1. NEVER store passwords in any custom table
2. NEVER use SUPABASE_SERVICE_ROLE_KEY in frontend/client code
3. ALL Supabase tables must have RLS enabled
4. Global CSS imports only in app/layout.tsx
5. JWT verification must happen inside Modal before any processing
6. Modal is the ONLY service that writes to cnn_feedback table