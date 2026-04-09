-- Adds sortable order column for admin question drag-and-drop.
-- Safe to run multiple times.

ALTER TABLE public.practice_questions
  ADD COLUMN IF NOT EXISTS question_order INTEGER;

ALTER TABLE public.assessment_questions
  ADD COLUMN IF NOT EXISTS question_order INTEGER;

WITH ranked AS (
  SELECT
    question_id,
    ROW_NUMBER() OVER (PARTITION BY level_id ORDER BY created_at, question_id) AS rn
  FROM public.practice_questions
)
UPDATE public.practice_questions pq
SET question_order = ranked.rn
FROM ranked
WHERE pq.question_id = ranked.question_id
  AND pq.question_order IS NULL;

WITH ranked AS (
  SELECT
    question_id,
    ROW_NUMBER() OVER (PARTITION BY level_id ORDER BY created_at, question_id) AS rn
  FROM public.assessment_questions
)
UPDATE public.assessment_questions aq
SET question_order = ranked.rn
FROM ranked
WHERE aq.question_id = ranked.question_id
  AND aq.question_order IS NULL;

CREATE INDEX IF NOT EXISTS idx_practice_questions_level_question_order
  ON public.practice_questions (level_id, question_order);

CREATE INDEX IF NOT EXISTS idx_assessment_questions_level_question_order
  ON public.assessment_questions (level_id, question_order);
