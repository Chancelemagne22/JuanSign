import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { logger } from '@/lib/logger'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const response = NextResponse.next()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Handle /admin/* routes (Supabase auth + admin table check)
  // V-3 fix: also cover bare /admin (matcher alone never sent it here before)
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    // NOTE: bare /admin must run the same auth check below (it renders
    // app/admin/(protected)/page.tsx for signed-in admins). Do NOT blanket-
    // redirect it to /admin/login — that creates a post-login loop.
    // Allow /admin/setup without auth (public invite page)
    if (pathname === '/admin/setup') {
      return response
    }

    // Allow /admin/login without auth
    if (pathname === '/admin/login' || pathname === '/admin/(auth)/login') {
      return response
    }

    // For protected admin routes (including bare /admin), check session + role.
    {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser()

        if (!user || userError) {
          return NextResponse.redirect(new URL('/admin/login', request.url))
        }

        // Check if user has admin or super_admin role in profiles table
        // V-8: disabled/archived accounts are bounced on their next request.
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role, is_active, is_archived')
          .eq('auth_user_id', user.id)
          .single()

        if (profileError || !profile || !['admin', 'super_admin'].includes(profile.role)) {
          // User is authenticated but not an admin
          return NextResponse.redirect(new URL('/admin/login', request.url))
        }

        if (profile.is_active === false || profile.is_archived === true) {
          return NextResponse.redirect(new URL('/admin/login', request.url))
        }
      } catch (error) {
        logger.error('middleware', 'admin_check_failed', { reason: error instanceof Error ? error.message : String(error) })
        return NextResponse.redirect(new URL('/admin/login', request.url))
      }
    }
  }

  // Handle /super-admin/* routes (Supabase role-based auth)
  // V-3 fix: also cover bare /super-admin
  if (pathname === '/super-admin' || pathname.startsWith('/super-admin/')) {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()

      if (!user || userError) {
        return NextResponse.redirect(new URL('/admin/login', request.url))
      }

      // Check user role in profiles table
      // V-8: disabled/archived accounts are bounced on their next request.
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, is_active, is_archived')
        .eq('auth_user_id', user.id)
        .single()

      if (!profile?.role) {
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }

      if (profile.is_active === false || profile.is_archived === true) {
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }

      if (profile.role !== 'super_admin') {
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }
    } catch (error) {
      logger.error('middleware', 'super_admin_check_failed', { reason: error instanceof Error ? error.message : String(error) })
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  // Handle /dashboard/* routes (student auth - check profiles table)
  // V-3 fix: also cover bare /dashboard (previously client-AuthGuard only → flash/bypass)
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()

      if (!user || userError) {
        return NextResponse.redirect(new URL('/', request.url))
      }

      // Make sure user has a profile (is a student, not admin)
      // V-8: disabled/archived students are bounced on their next request.
      const { data: profile } = await supabase
        .from('profiles')
        .select('profile_id, is_active, is_archived')
        .eq('auth_user_id', user.id)
        .single()

      if (!profile) {
        return NextResponse.redirect(new URL('/', request.url))
      }

      if (profile.is_active === false || profile.is_archived === true) {
        return NextResponse.redirect(new URL('/', request.url))
      }
    } catch (error) {
      logger.error('middleware', 'dashboard_check_failed', { reason: error instanceof Error ? error.message : String(error) })
      return NextResponse.redirect(new URL('/', request.url))
    }
  }

  return response
}

export const config = {
  matcher: ['/admin', '/admin/:path*', '/dashboard', '/dashboard/:path*', '/super-admin', '/super-admin/:path*'],
}