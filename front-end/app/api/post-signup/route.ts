import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { checkRateLimit, getClientIp, rateLimitHeaders } from '@/lib/rateLimit'
import { logger } from '@/lib/logger'

// Uses service role — runs server-side only, never exposed to client.
// Handles avatar upload + profile update when no session exists yet
// (i.e. email confirmation is required and user hasn't confirmed yet).
//
// V-9: the caller-supplied `userId` is NOT trusted on its own. Authorization:
//  - If the client has a session (confirmation OFF), it must send it as a
//    Bearer token and the token's user id must equal `userId`.
//  - Otherwise (confirmation ON, no session yet) we only allow accounts created
//    in the last 15 minutes AND require the signup `email` to match the auth
//    record. This shrinks the spoofing window from "any user, forever" to
//    "just-created account whose email you know, for 15 minutes".

const RECENT_ACCOUNT_MS = 15 * 60 * 1000
const SIGNUP_LIMIT = 10
const SIGNUP_WINDOW_MS = 60 * 60 * 1000

export async function POST(request: NextRequest) {
  const rl = checkRateLimit(`post-signup:${getClientIp(request)}`, SIGNUP_LIMIT, SIGNUP_WINDOW_MS)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many signup attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': '3600', ...rateLimitHeaders(rl.remaining, rl.resetAt) } }
    )
  }

  const formData = await request.formData()
  const userId    = formData.get('userId')    as string
  const username  = formData.get('username')  as string
  const firstName = formData.get('firstName') as string
  const lastName  = formData.get('lastName')  as string
  const email     = (formData.get('email') as string | null)?.trim().toLowerCase() ?? null
  const photo     = formData.get('photo')     as File | null

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  }

  // Path A — client has a session: it must belong to `userId`.
  const authHeader = request.headers.get('authorization') || ''
  if (authHeader.startsWith('Bearer ')) {
    const { data, error } = await supabaseAdmin.auth.getUser(authHeader.slice(7))
    if (error || !data?.user || data.user.id !== userId) {
      logger.warn('post-signup', 'session_user_mismatch')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else {
    // Path B — no session: just-created account + email match only.
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId)
    if (error || !data?.user) {
      logger.warn('post-signup', 'unknown_user')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const createdAt = new Date(data.user.created_at ?? 0).getTime()
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > RECENT_ACCOUNT_MS) {
      logger.warn('post-signup', 'stale_account')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!email || (data.user.email ?? '').toLowerCase() !== email) {
      logger.warn('post-signup', 'email_mismatch')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = supabaseAdmin

  let avatarUrl: string | null = null

  // V-5/V-9: upload caps — 2 MB, image MIME allowlist, extension from MIME.
  const AVATAR_MAX_BYTES = 2 * 1024 * 1024
  const AVATAR_MIME_ALLOW = new Map([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
  ])

  if (photo && photo.size > 0) {
    if (photo.size > AVATAR_MAX_BYTES) {
      return NextResponse.json({ error: 'Avatar too large (max 2 MB)' }, { status: 413 })
    }
    const ext = AVATAR_MIME_ALLOW.get(photo.type)
    if (!ext) {
      return NextResponse.json({ error: 'Unsupported avatar type (jpeg/png/webp only)' }, { status: 415 })
    }
    const filePath = `${userId}.${ext}`
    const buffer   = await photo.arrayBuffer()

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, buffer, { contentType: photo.type, upsert: true })

    if (!uploadError) {
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath)
      avatarUrl = urlData.publicUrl
    }
  }

  await supabase
    .from('profiles')
    .update({
      username,
      first_name: firstName,
      last_name:  lastName,
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    })
    .eq('auth_user_id', userId)

  return NextResponse.json({ avatarUrl })
}
