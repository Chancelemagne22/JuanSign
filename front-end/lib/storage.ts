import { supabase } from './supabase'

/**
 * Fetch all video files from the lessons-videos bucket
 * This function calls a server-side API endpoint that uses the service role key
 */
export async function listLessonVideos(): Promise<string[]> {
  try {
    console.log('[Storage] Fetching videos from API endpoint...')
    
    // Call our server-side API endpoint that uses service role key
    const response = await fetch('/api/admin/lessons?action=list-videos')
    if (response.ok) {
      const result = await response.json()
      console.log('[Storage] Got videos from API:', result.videos)
      if (result.videos && Array.isArray(result.videos)) {
        return result.videos
      }
    } else {
      console.warn('[Storage] API returned status:', response.status)
    }
    
    return []
  } catch (err) {
    console.error('[Storage] Error fetching lesson videos:', err)
    return []
  }
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
