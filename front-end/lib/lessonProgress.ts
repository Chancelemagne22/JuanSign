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
