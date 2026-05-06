import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function POST(request: NextRequest) {
  const { email, password } = await request.json()

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
        console.error("DB Error:", profileError);
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
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'An error occurred during login.' },
      { status: 500 }
    )
  }
}
