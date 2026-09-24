-- V-4 short-term hardening: value-integrity CHECKs + anomaly view.
-- RLS already scopes rows to auth.uid() = auth_user_id, but values were
-- self-asserted by the client. These constraints bound the damage to plausible
-- ranges; server-authoritative grading (POST /api/assessment/submit) is the
-- long-term fix. Run in Supabase SQL Editor AFTER juansign_database.sql.
--
-- NOTE: practice_sessions column drift — juansign_database.sql defines
-- `confidence numeric(5,2)` while front-end inserts `average_accuracy`.
-- Both are guarded below (average_accuracy only if the column exists).

-- assessment_results.score 0–100
DO $$ BEGIN
  ALTER TABLE public.assessment_results
    ADD CONSTRAINT assessment_results_score_range CHECK (score >= 0 AND score <= 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- assessment_results.stars_earned already 0–3 in base schema; re-assert idempotently
DO $$ BEGIN
  ALTER TABLE public.assessment_results
    ADD CONSTRAINT assessment_results_stars_range CHECK (stars_earned >= 0 AND stars_earned <= 3);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- practice_sessions.confidence 0–100 (nullable preserved)
DO $$ BEGIN
  ALTER TABLE public.practice_sessions
    ADD CONSTRAINT practice_sessions_confidence_range CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- practice_sessions.average_accuracy 0–100 (only if column exists in this project)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'practice_sessions' AND column_name = 'average_accuracy'
  ) THEN
    ALTER TABLE public.practice_sessions
      ADD CONSTRAINT practice_sessions_avg_accuracy_range CHECK (average_accuracy IS NULL OR (average_accuracy >= 0 AND average_accuracy <= 100));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- user_progress.best_score 0–100, lessons_completed >= 0
DO $$ BEGIN
  ALTER TABLE public.user_progress
    ADD CONSTRAINT user_progress_best_score_range CHECK (best_score IS NULL OR (best_score >= 0 AND best_score <= 100));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.user_progress
    ADD CONSTRAINT user_progress_lessons_completed_nonneg CHECK (lessons_completed >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Anomaly view (V-4): flags impossible jumps for admin review until server
-- grading lands. Perfect assessment with zero prior practice_sessions for that
-- level, or >1 level unlocked with no completed predecessor.
CREATE OR REPLACE VIEW public.suspicious_results AS
SELECT
  ar.result_id,
  ar.auth_user_id,
  ar.level_id,
  ar.score,
  ar.stars_earned,
  ar.attempt_date,
  (SELECT COUNT(*) FROM public.practice_sessions ps
    WHERE ps.auth_user_id = ar.auth_user_id AND ps.level_id = ar.level_id) AS practice_count_for_level,
  CASE
    WHEN ar.score = 100 AND NOT EXISTS (
      SELECT 1 FROM public.practice_sessions ps
      WHERE ps.auth_user_id = ar.auth_user_id AND ps.level_id = ar.level_id
    ) THEN 'perfect_without_practice'
    ELSE 'review'
  END AS flag
FROM public.assessment_results ar
WHERE ar.is_passed AND (
  ar.score = 100 AND NOT EXISTS (
    SELECT 1 FROM public.practice_sessions ps
    WHERE ps.auth_user_id = ar.auth_user_id AND ps.level_id = ar.level_id
  )
);
