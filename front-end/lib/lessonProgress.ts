import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

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
      logger.warn('lessonProgress', 'has_viewed_failed');
      return false;
    }

    return !!data;
  } catch (e) {
    logger.error('lessonProgress', 'has_viewed_error', { reason: e instanceof Error ? e.message : String(e) });
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
      logger.warn('lessonProgress', 'mark_viewed_failed');
    }
  } catch (e) {
    logger.error('lessonProgress', 'mark_viewed_error', { reason: e instanceof Error ? e.message : String(e) });
  }
}
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
      logger.warn('lessonProgress', 'save_page_failed');
      return null;
    }

    return data?.last_page_index ?? null;
  } catch (e) {
    logger.error('lessonProgress', 'save_page_error', { reason: e instanceof Error ? e.message : String(e) });
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
      logger.warn('lessonProgress', 'get_page_failed');
      return 0;
    }

    return data?.last_page_index ?? 0;
  } catch (e) {
    logger.error('lessonProgress', 'get_page_error', { reason: e instanceof Error ? e.message : String(e) });
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
      logger.warn('lessonProgress', 'reset_page_failed');
      return false;
    }

    return true;
  } catch (e) {
    logger.error('lessonProgress', 'reset_page_error', { reason: e instanceof Error ? e.message : String(e) });
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
/**
 * I-2: prefers the get_user_stats() RPC (1 round-trip). Falls back to the
 * legacy multi-query path when the RPC is not deployed yet (undefined
 * function) or denies access — deploy order is safe either way.
 */
async function fetchStatsRpc(userId: string): Promise<{ completion_rate: number; stars: number } | null> {
  try {
    const { data, error } = await supabase.rpc('get_user_stats', { p_auth_user_id: userId });
    if (error || !data) return null;
    const row = data as { completion_rate?: number; stars?: number };
    if (typeof row.completion_rate !== 'number' || typeof row.stars !== 'number') return null;
    return { completion_rate: row.completion_rate, stars: row.stars };
  } catch {
    return null;
  }
}

export async function getOverallCompletionRate(userId: string): Promise<number> {
  try {
    const viaRpc = await fetchStatsRpc(userId);
    if (viaRpc) return viaRpc.completion_rate;

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
  } catch {
    logger.warn('lessonProgress', 'completion_rate_failed');
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
    const viaRpc = await fetchStatsRpc(userId);
    if (viaRpc) return viaRpc.stars;

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
  } catch {
    logger.warn('lessonProgress', 'stars_failed');
    return 0;
  }
}
