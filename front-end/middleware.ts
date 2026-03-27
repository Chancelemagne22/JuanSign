import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  
  // ── ADMIN ROUTES (separate auth system using ADMIN_AUTH_SECRET) ──
  const adminAuth = request.cookies.get('admin_auth')?.value
  const secret = process.env.ADMIN_AUTH_SECRET
  const isAdminAuthenticated = !!(adminAuth && secret && adminAuth === secret)

  // If on admin login page and already authenticated, redirect to admin dashboard
  if (pathname === '/admin/login') {
    if (isAdminAuthenticated) {
      return NextResponse.redirect(new URL('/admin', request.url))
    }
    return NextResponse.next()
  }

  // Protect all /admin routes — admin auth is separate from student auth
  if (pathname.startsWith('/admin')) {
    if (!isAdminAuthenticated) {
      return NextResponse.redirect(new URL('/admin/login', request.url))
    }
  }

  // ── STUDENT ROUTES (use Supabase JWT stored in cookies/localStorage) ──
  // Note: Supabase JS SDK stores session in localStorage (client-side).
  // For true server-side verification, we'd need to read from request context.
  // Since middleware cannot access client-stored localStorage, we check if
  // a session cookie exists (optional setup — requires custom auth setup).
  // For now, we'll redirect unauthenticated users at page-level in layout components.
  // 
  // This is a limitation of middleware on client-side auth. To enforce here,
  // students can configure Supabase to use HTTP-only cookies for sessions:
  // https://supabase.com/docs/guides/auth/auth-helpers/nextjs#configure
  //
  // TEMPORARY: We rely on component-level redirects in dashboard layout.
  // TODO: Implement Supabase session cookies to make middleware auth work here.

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin', '/admin/(.*)', '/dashboard', '/dashboard/(.*)'],
}
