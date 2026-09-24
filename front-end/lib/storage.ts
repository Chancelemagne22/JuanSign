import { supabase } from './supabase'
import { logger } from '@/lib/logger'

/**
 * Fetch video files from the lessons-videos bucket with pagination and search
 * This function calls a server-side API endpoint that uses the service role key
 */
export async function listLessonVideos(options: {
  page?: number
  limit?: number
  search?: string
} = {}): Promise<{
  videos: string[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}> {
  try {
    logger.debug('storage', 'fetch_videos', { page: options.page ?? null })
    
    const params = new URLSearchParams()
    if (options.page) params.set('page', options.page.toString())
    if (options.limit) params.set('limit', options.limit.toString())
    if (options.search) params.set('search', options.search.trim())
    
    // Call our server-side API endpoint that uses service role key
    const response = await fetch(`/api/admin/lessons?action=list-videos&${params}`)
    if (response.ok) {
      const result = await response.json()
      logger.debug('storage', 'videos_received', { total: result.total ?? 0 })
      return {
        videos: result.videos || [],
        total: result.total || 0,
        page: result.page || 1,
        limit: result.limit || 150,
        hasMore: result.hasMore || false
      }
    } else {
      logger.warn('storage', 'api_status', { status: response.status })
    }
    
    return { videos: [], total: 0, page: 1, limit: 150, hasMore: false }
  } catch (err) {
    logger.error('storage', 'fetch_failed', { reason: err instanceof Error ? err.message : String(err) })
    return { videos: [], total: 0, page: 1, limit: 150, hasMore: false }
  }
}

/**
 * Legacy function for backward compatibility - returns just the videos array
 */
export async function listLessonVideosLegacy(): Promise<string[]> {
  const result = await listLessonVideos()
  return result.videos
}

/**
 * Get the public URL for a lesson video
 * @param filename - Video filename without extension (e.g., 'A')
 * @returns Full public URL to the video
 */
export function getLessonVideoUrl(filename: string): string {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!projectUrl) {
    logger.error('storage', 'missing_project_url')
    return ''
  }
  // Support both .mp4 and .mp44 - try .mp4 first as that's the standard
  return `${projectUrl}/storage/v1/object/public/lessons-videos/${filename}.mp4`
}
