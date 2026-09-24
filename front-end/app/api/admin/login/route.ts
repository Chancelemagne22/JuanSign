import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { checkRateLimit, getClientIp, rateLimitHeaders } from '@/lib/rateLimit'
import { logger } from '@/lib/logger'

// V-5: 5 login attempts / 10 min per IP+email (brute-force guard).
const LOGIN_LIMIT = 5
const LOGIN_WINDOW_MS = 10 * 60 * 1000

export async function POST(request: NextRequest) {
  const { email, password } = await request.json()

  const rl = checkRateLimit(
    `login:${getClientIp(request)}:${String(email ?? '').toLowerCase().slice(0, 120)}`,
    LOGIN_LIMIT,
    LOGIN_WINDOW_MS
  )
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': '600', ...rateLimitHeaders(rl.remaining, rl.resetAt) } }
    )
  }

  try {
    // Create Supabase client for server
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              // We'll set these in the response below
            })
          },
        },
      }
    )

    // Sign in with email and password
    const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) return NextResponse.json({ error: signInError.message }, { status: 401 });

    const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, is_archived')
    .eq('auth_user_id', authData.user.id)
    .single();

    if (profileError) {
        logger.error("admin/login", "profile_lookup_failed", { reason: profileError.message ?? "unknown" });
        return NextResponse.json({ error: "Database lookup failed. Check RLS policies." }, { status: 500 });
    }

    if (profile.is_archived) {
      await supabase.auth.signOut();
      return NextResponse.json({ error: "Account archived." }, { status: 403 });
    }

    if (profileError || !profile || !['admin', 'super_admin'].includes(profile.role)) {
      // User exists in auth but doesn't have admin role - not authorized
      return NextResponse.json(
        { error: 'You are not authorized as an admin.' },
        { status: 403 }
      )
    }

    // Admin found - return session data to client
    return NextResponse.json({
      success: true,
      session: authData.session,
    })
  } catch (error) {
    logger.error('admin/login', 'handler_error', { reason: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: 'An error occurred during login.' },
      { status: 500 }
    )
  }
}
