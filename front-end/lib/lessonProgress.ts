import { supabase } from '@/lib/supabase';

/**
 * Check if the user has already viewed a lesson
 * Returns true if the lesson is in lessons_viewed table, false if first time
 */
export async function hasViewedLesson(userId: string, lessonId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('lessons_viewed')
      .select('view_id')
      .eq('auth_user_id', userId)
      .eq('lesson_id', lessonId)
      .single();

    if (error && error.code === 'PGRST116') {
      // No row found — user hasn't viewed this lesson yet
      return false;
    }

    if (error) {
      console.warn('[lessonProgress] hasViewedLesson error:', { error, userId, lessonId });
      return false;
    }

    return !!data;
  } catch (e) {
    console.error('[lessonProgress] hasViewedLesson exception:', e);
    return false;
  }
}

/**
 * Mark a lesson as viewed
 * Creates a record in lessons_viewed if it doesn't exist (UNIQUE constraint prevents duplicates)
 */
export async function markLessonViewed(userId: string, lessonId: string): Promise<void> {
  try {
    const { error } = await supabase.from('lessons_viewed').insert({
      auth_user_id: userId,
      lesson_id: lessonId,
    });

    if (error) {
      console.warn('[lessonProgress] markLessonViewed error:', { error, userId, lessonId });
    }
  } catch (e) {
    console.error('[lessonProgress] markLessonViewed exception:', e);
  }
}

/**
 * Fetch all focused lessons for a user in a specific level
 * Returns array of lesson objects with id, lesson_title, lesson_order
 * 
 * ⚠️ REMOVED - Feature removed on 2026-04-02
 */

/**
 * Check if a lesson is in the user's focused_lessons list
 * 
 * ⚠️ REMOVED - Feature removed on 2026-04-02
 */

/**
 * Toggle a lesson in the focused_lessons table
 * If already focused, remove it. If not focused, add it.
 * Returns the new state (true = now focused, false = now unfocused)
 * 
 * ⚠️ REMOVED - Feature removed on 2026-04-02
 */

/**
 * Save the user's current page index for a lesson (Resume feature)
 * Creates a new record if one doesn't exist, updates if it does (UPSERT)
 *
 * @param userId - The authenticated user ID
 * @param lessonId - The lesson UUID
 * @param pageIndex - The current page index (0-based)
 * @returns The updated page index on success, null on error
 */
export async function saveLastPageIndex(
  userId: string,
  lessonId: string,
  pageIndex: number,
): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('lessons_viewed')
      .upsert(
        {
          auth_user_id: userId,
          lesson_id: lessonId,
          last_page_index: Math.max(0, Math.floor(pageIndex)),
          viewed_at: new Date().toISOString(),
        },
        { onConflict: 'auth_user_id,lesson_id' },
      )
      .select('last_page_index')
      .single();

    if (error) {
      console.warn('[lessonProgress] saveLastPageIndex error:', { error, userId, lessonId, pageIndex });
      return null;
    }

    return data?.last_page_index ?? null;
  } catch (e) {
    console.error('[lessonProgress] saveLastPageIndex exception:', e);
    return null;
  }
}

/**
 * Get the user's last saved page index for a lesson
 * Returns the page index if it exists, 0 (first page) if not
 *
 * @param userId - The authenticated user ID
 * @param lessonId - The lesson UUID
 * @returns The saved page index (0-based), or 0 if not found
 */
export async function getLastPageIndex(
  userId: string,
  lessonId: string,
): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('lessons_viewed')
      .select('last_page_index')
      .eq('auth_user_id', userId)
      .eq('lesson_id', lessonId)
      .single();

    if (error && error.code === 'PGRST116') {
      // No record found — user hasn't viewed this lesson yet
      return 0;
    }

    if (error) {
      console.warn('[lessonProgress] getLastPageIndex error:', { error, userId, lessonId });
      return 0;
    }

    return data?.last_page_index ?? 0;
  } catch (e) {
    console.error('[lessonProgress] getLastPageIndex exception:', e);
    return 0;
  }
}

/**
 * Reset the page index for a lesson (start over from page 0)
 * Useful for "Restart" or "Start Over" buttons
 *
 * @param userId - The authenticated user ID
 * @param lessonId - The lesson UUID
 * @returns true if successful, false on error
 */
export async function resetLastPageIndex(
  userId: string,
  lessonId: string,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('lessons_viewed')
      .update({ last_page_index: 0 })
      .eq('auth_user_id', userId)
      .eq('lesson_id', lessonId);

    if (error) {
      console.warn('[lessonProgress] resetLastPageIndex error:', { error, userId, lessonId });
      return false;
    }

    return true;
  } catch (e) {
    console.error('[lessonProgress] resetLastPageIndex exception:', e);
    return false;
  }
}

/**
 * Get an overall completion rate based on completed lessons, practice, and assessments.
 *
 * The rate is calculated from the unique milestone counts:
 * - Lesson completion per level
 * - Practice completion per level
 * - Passed assessments per level
 *
 * This keeps the profile modal in sync with the actual learning flow instead of
 * relying on unlocked levels alone.
 */
export async function getOverallCompletionRate(userId: string): Promise<number> {
  try {
    const [levelsResult, progressResult, practiceResult, assessmentResult, practiceContentResult, assessmentContentResult] =
      await Promise.all([
        supabase.from('levels').select('level_id'),
        supabase.from('user_progress').select('level_id, lessons_completed').eq('auth_user_id', userId),
        supabase.from('practice_sessions').select('level_id').eq('auth_user_id', userId),
        supabase.from('assessment_results').select('level_id, is_passed').eq('auth_user_id', userId),
        supabase.from('practice_questions').select('level_id'),
        supabase.from('assessment_questions').select('level_id'),
      ]);

    const totalLessons = levelsResult.data?.length ?? 0;
    const totalPractices = new Set((practiceContentResult.data ?? []).map((row) => row.level_id)).size;
    const totalAssessments = new Set((assessmentContentResult.data ?? []).map((row) => row.level_id)).size;

    const completedLessons = new Set(
      (progressResult.data ?? [])
        .filter((row) => (row.lessons_completed ?? 0) > 0)
        .map((row) => row.level_id)
    ).size;

    const completedPractices = new Set((practiceResult.data ?? []).map((row) => row.level_id)).size;
    const completedAssessments = new Set(
      (assessmentResult.data ?? [])
        .filter((row) => row.is_passed)
        .map((row) => row.level_id)
    ).size;

    const totalMilestones = totalLessons + totalPractices + totalAssessments;
    const completedMilestones = completedLessons + completedPractices + completedAssessments;

    return totalMilestones > 0 ? Math.round((completedMilestones / totalMilestones) * 100) : 0;
  } catch (error) {
    console.warn('[lessonProgress] getOverallCompletionRate error:', error);
    return 0;
  }
}

function normalizeAccuracyPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const percent = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, percent));
}

function starsFromPercent(percent: number): number {
  if (percent >= 80) return 3;
  if (percent >= 60) return 2;
  if (percent >= 40) return 1;
  return 0;
}

/**
 * Get total stars for profile display.
 *
 * Star sources:
 * - Lessons: 1 star per level with at least one completed lesson.
 * - Assessments: best (max) stars per level from assessment results.
 */
export async function getOverallStars(userId: string): Promise<number> {
  try {
    const [progressResult, assessmentResult] = await Promise.all([
      supabase
        .from('user_progress')
        .select('level_id, lessons_completed')
        .eq('auth_user_id', userId),
      supabase
        .from('assessment_results')
        .select('level_id, stars_earned, score')
        .eq('auth_user_id', userId),
    ]);

    const lessonStars = new Set(
      (progressResult.data ?? [])
        .filter((row) => (row.lessons_completed ?? 0) > 0)
        .map((row) => row.level_id)
    ).size;

    const assessmentBestByLevel = new Map<string, number>();
    for (const row of assessmentResult.data ?? []) {
      const normalizedFromScore = starsFromPercent(normalizeAccuracyPercent(row.score ?? 0));
      const directStars = Number.isFinite(row.stars_earned ?? NaN)
        ? Math.max(0, Math.min(3, row.stars_earned ?? 0))
        : normalizedFromScore;
      const nextStars = Math.max(directStars, normalizedFromScore);
      const prev = assessmentBestByLevel.get(row.level_id) ?? 0;
      if (nextStars > prev) assessmentBestByLevel.set(row.level_id, nextStars);
    }
    const assessmentStars = Array.from(assessmentBestByLevel.values()).reduce((sum, value) => sum + value, 0);

    return lessonStars + assessmentStars;
  } catch (error) {
    console.warn('[lessonProgress] getOverallStars error:', error);
    return 0;
  }
}
