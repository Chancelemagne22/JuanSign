-- I-2: single-call user stats for the profile modal.
-- lib/lessonProgress.ts getOverallCompletionRate() fired 6 queries and
-- getOverallStars() 2 more on every modal open. This RPC computes both numbers
-- server-side in one round-trip. The client tries the RPC first and falls back
-- to the multi-query path when the function is absent (error 42883), so deploy
-- order is safe either way. Run in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.get_user_stats(p_auth_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_lessons       int := 0;
  v_total_practices     int := 0;
  v_total_assessments   int := 0;
  v_done_lessons        int := 0;
  v_done_practices      int := 0;
  v_done_assessments    int := 0;
  v_lesson_stars        int := 0;
  v_assessment_stars    int := 0;
BEGIN
  -- Caller may only read their own stats (function bypasses RLS as definer).
  IF auth.uid() IS DISTINCT FROM p_auth_user_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_total_lessons FROM public.levels;
  SELECT COUNT(DISTINCT level_id) INTO v_total_practices FROM public.practice_questions;
  SELECT COUNT(DISTINCT level_id) INTO v_total_assessments FROM public.assessment_questions;

  SELECT COUNT(DISTINCT level_id) INTO v_done_lessons
    FROM public.user_progress
   WHERE auth_user_id = p_auth_user_id AND COALESCE(lessons_completed, 0) > 0;

  SELECT COUNT(DISTINCT level_id) INTO v_done_practices
    FROM public.practice_sessions
   WHERE auth_user_id = p_auth_user_id;

  SELECT COUNT(DISTINCT level_id) INTO v_done_assessments
    FROM public.assessment_results
   WHERE auth_user_id = p_auth_user_id AND is_passed;

  v_lesson_stars := v_done_lessons;

  -- Best stars per level: max(direct stars_earned, stars derived from score),
  -- mirroring the client starsFromPercent/normalizeAccuracyPercent logic.
  SELECT COALESCE(SUM(best), 0) INTO v_assessment_stars
    FROM (
      SELECT GREATEST(
        LEAST(COALESCE(MAX(stars_earned), 0), 3),
        CASE
          WHEN COALESCE(MAX(
            CASE WHEN score <= 1 THEN score * 100 ELSE score END
          ), 0) >= 80 THEN 3
          WHEN COALESCE(MAX(
            CASE WHEN score <= 1 THEN score * 100 ELSE score END
          ), 0) >= 60 THEN 2
          WHEN COALESCE(MAX(
            CASE WHEN score <= 1 THEN score * 100 ELSE score END
          ), 0) >= 40 THEN 1
          ELSE 0
        END
      ) AS best
        FROM public.assessment_results
       WHERE auth_user_id = p_auth_user_id
       GROUP BY level_id
    ) s;

  RETURN jsonb_build_object(
    'completion_rate',
      CASE WHEN (v_total_lessons + v_total_practices + v_total_assessments) > 0
        THEN ROUND(
          (v_done_lessons + v_done_practices + v_done_assessments)::numeric
          / (v_total_lessons + v_total_practices + v_total_assessments) * 100
        )
        ELSE 0 END,
    'stars', v_lesson_stars + v_assessment_stars
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_stats(uuid) TO authenticated;
