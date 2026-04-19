import { supabase } from './supabase'

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
    console.log('[Storage] Fetching videos from API endpoint...', options)
    
    const params = new URLSearchParams()
    if (options.page) params.set('page', options.page.toString())
    if (options.limit) params.set('limit', options.limit.toString())
    if (options.search) params.set('search', options.search.trim())
    
    // Call our server-side API endpoint that uses service role key
    const response = await fetch(`/api/admin/lessons?action=list-videos&${params}`)
    if (response.ok) {
      const result = await response.json()
      console.log('[Storage] Got videos from API:', result)
      return {
        videos: result.videos || [],
        total: result.total || 0,
        page: result.page || 1,
        limit: result.limit || 20,
        hasMore: result.hasMore || false
      }
    } else {
      console.warn('[Storage] API returned status:', response.status)
    }
    
    return { videos: [], total: 0, page: 1, limit: 20, hasMore: false }
  } catch (err) {
    console.error('[Storage] Error fetching lesson videos:', err)
    return { videos: [], total: 0, page: 1, limit: 20, hasMore: false }
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
    console.error('[Storage] NEXT_PUBLIC_SUPABASE_URL not defined')
    return ''
  }
  // Support both .mp4 and .mp44 - try .mp4 first as that's the standard
  return `${projectUrl}/storage/v1/object/public/lessons-videos/${filename}.mp4`
}
