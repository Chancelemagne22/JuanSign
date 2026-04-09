import { supabase } from '@/lib/supabase'

/**
 * Fetch helper for admin API routes.
 * Automatically attaches the Bearer token from current session.
 *
 * @param url - The API endpoint URL
 * @param options - Standard fetch options
 * @returns The fetch response
 * @throws Error if no session token is available
 */
export async function adminFetch(url: string, options?: RequestInit) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError || !sessionData.session?.access_token) {
    throw new Error('Unauthorized')
  }

  const token = sessionData.session.access_token

  const headers = new Headers(options?.headers)
  headers.set('Authorization', `Bearer ${token}`)

  return fetch(url, {
    ...options,
    headers,
  })
}
