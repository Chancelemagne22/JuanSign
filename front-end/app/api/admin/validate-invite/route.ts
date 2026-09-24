import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { checkRateLimit, getClientIp, rateLimitHeaders } from '@/lib/rateLimit'
import { logger } from '@/lib/logger'

// V-10: public invite check. Previously returned distinct 404 (not found) vs
// 410 (used/expired), letting attackers enumerate valid codes — compounded by
// weak 8-char Math.random codes (now CSPRNG 16-char, see generateInviteCode).
// Now: throttled (20/hr per IP) + uniform 200 with { valid: true|false } and a
// generic error string. No code echo. Callers must check `data.valid`,
// not `response.ok`.

const VALIDATE_LIMIT = 20
const VALIDATE_WINDOW_MS = 60 * 60 * 1000

export async function GET(request: NextRequest) {
  const rl = checkRateLimit(
    `validate-invite:${getClientIp(request)}`,
    VALIDATE_LIMIT,
    VALIDATE_WINDOW_MS
  )
  if (!rl.allowed) {
    return NextResponse.json(
      { valid: false, error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': '3600', ...rateLimitHeaders(rl.remaining, rl.resetAt) } }
    )
  }

  try {
    const { searchParams } = new URL(request.url)
    const raw = (searchParams.get('code') ?? '').trim().toUpperCase().slice(0, 64)

    if (!raw) {
      return NextResponse.json(
        { valid: false, error: 'Invalid or expired invite code.' },
        { status: 200 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('admin_invites')
      .select('id, is_used, expires_at')
      .eq('code', raw)
      .single()

    if (error || !data || data.is_used || new Date(data.expires_at) < new Date()) {
      return NextResponse.json(
        { valid: false, error: 'Invalid or expired invite code.' },
        { status: 200 }
      )
    }

    return NextResponse.json({ valid: true, expiresAt: data.expires_at })
  } catch (error) {
    logger.error('admin/validate-invite', 'validation_error', {
      reason: error instanceof Error ? error.message : String(error),
    })
    // Uniform failure — never leak which branch failed.
    return NextResponse.json(
      { valid: false, error: 'Invalid or expired invite code.' },
      { status: 200 }
    )
  }
}
