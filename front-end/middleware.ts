import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

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
  if (pathname.startsWith('/admin/')) {
    // Allow /admin/setup without auth (public invite page)
    if (pathname === '/admin/setup') {
      return response
    }

    // Allow /admin/login without auth
    if (pathname === '/admin/login' || pathname === '/admin/(auth)/login') {
      return response
    }

    // For protected admin routes, check Supabase session and admin role in profiles
    if (pathname.startsWith('/admin/')) {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser()

        if (!user || userError) {
          return NextResponse.redirect(new URL('/admin/login', request.url))
        }

        // Check if user has admin or super_admin role in profiles table
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role')
          .eq('auth_user_id', user.id)
          .single()

        if (profileError || !profile || !['admin', 'super_admin'].includes(profile.role)) {
          // User is authenticated but not an admin
          return NextResponse.redirect(new URL('/admin/login', request.url))
        }
      } catch (error) {
        console.error('Admin middleware error:', error)
        return NextResponse.redirect(new URL('/admin/login', request.url))
      }
    }
  }

  // Handle /super-admin/* routes (Supabase role-based auth)
  if (pathname.startsWith('/super-admin/')) {
    console.log('[Middleware] Checking super-admin route:', pathname)
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      
      console.log('[Middleware] Auth user:', user?.id, 'Error:', userError?.message)
      
      if (!user || userError) {
        console.log('[Middleware] No user found, redirecting to /admin/login')
        return NextResponse.redirect(new URL('/admin/login', request.url))
      }

      // Check user role in profiles table
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('auth_user_id', user.id)
        .single()

      console.log('[Middleware] Profile query - Data:', profile, 'Error:', profileError?.message)

      if (!profile?.role) {
        console.log('[Middleware] No profile or role found, redirecting to /dashboard')
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }

      console.log('[Middleware] User role:', profile.role, '| Required: super_admin | Match:', profile.role === 'super_admin')

      if (profile.role !== 'super_admin') {
        console.log('[Middleware] Role mismatch - redirecting to /dashboard')
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }

      console.log('[Middleware] Authorization passed, allowing access')
    } catch (error) {
      console.error('[Middleware] Super-admin middleware error:', error)
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  // Handle /dashboard/* routes (student auth - check profiles table)
  if (pathname.startsWith('/dashboard/')) {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()

      if (!user || userError) {
        return NextResponse.redirect(new URL('/', request.url))
      }

      // Make sure user has a profile (is a student, not admin)
      const { data: profile } = await supabase
        .from('profiles')
        .select('profile_id')
        .eq('auth_user_id', user.id)
        .single()

      if (!profile) {
        return NextResponse.redirect(new URL('/', request.url))
      }
    } catch (error) {
      console.error('Dashboard middleware error:', error)
      return NextResponse.redirect(new URL('/', request.url))
    }
  }

  return response
}

export const config = {
  matcher: ['/admin/:path*', '/dashboard/:path*', '/super-admin/:path*'],
}