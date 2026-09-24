-- I-1/I-2 performance indexes for admin aggregation endpoints.
-- The admin users/reports APIs join practice_sessions, assessment_results,
-- user_progress and lessons_viewed per auth_user_id with date ordering.
-- Base schema only ships single-column user indexes; these composite indexes
-- make the per-user groupings + latest-row lookups index-friendly.
-- Idempotent (IF NOT EXISTS). Run in Supabase SQL Editor.

CREATE INDEX IF NOT EXISTS idx_practice_sessions_user_date
  ON public.practice_sessions (auth_user_id, session_date DESC);

CREATE INDEX IF NOT EXISTS idx_assessment_results_user_date
  ON public.assessment_results (auth_user_id, attempt_date DESC);

CREATE INDEX IF NOT EXISTS idx_assessment_results_user_passed
  ON public.assessment_results (auth_user_id, is_passed);

CREATE INDEX IF NOT EXISTS idx_user_progress_user_unlocked
  ON public.user_progress (auth_user_id, is_unlocked);

CREATE INDEX IF NOT EXISTS idx_lessons_viewed_user_lesson
  ON public.lessons_viewed (auth_user_id, lesson_id);

CREATE INDEX IF NOT EXISTS idx_profiles_role_created
  ON public.profiles (role, created_at DESC);

-- Follow-up (not this file): replace full-table admin aggregations with a
-- dedicated view/RPC (admin_users_overview) + server-side pagination once the
-- admin UI is ready for it. The API already joins in linear time (Maps) and
-- pages auth emails with early-stop; these indexes cover the remaining scans.
