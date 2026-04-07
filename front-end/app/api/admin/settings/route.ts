import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

async function getAuthorizedUser(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.substring(7)
  const { data: user, error: authError } = await supabaseAdmin.auth.getUser(token)

  if (authError || !user) {
    return null
  }

  const userId = user.user?.id || user.id
  
  if (!userId) {
    return null
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('auth_user_id', userId)
    .single()

  if (profileError || !profile || !['admin', 'super_admin'].includes(profile.role)) {
    return null
  }

  return user
}

// GET /api/admin/settings — health check + system info
export async function GET(request: NextRequest) {
  const user = await getAuthorizedUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check Supabase connectivity
  let supabaseStatus = 'Offline'
  try {
    const { error } = await supabaseAdmin.from('profiles').select('profile_id').limit(1)
    if (!error) supabaseStatus = 'Online'
  } catch {
    supabaseStatus = 'Offline'
  }

  // Check Modal endpoint connectivity
  let modalStatus = 'Offline'
  const modalUrl = process.env.NEXT_PUBLIC_MODAL_ENDPOINT_URL
  if (modalUrl) {
    try {
      const res = await fetch(modalUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
      modalStatus = res.ok || res.status < 500 ? 'Online' : 'Offline'
    } catch {
      modalStatus = 'Offline'
    }
  } else {
    modalStatus = 'Not configured'
  }

  return NextResponse.json({
    supabase: supabaseStatus,
    modal: modalStatus,
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? 'v1.0',
    environment: process.env.NEXT_PUBLIC_ENV ?? process.env.NODE_ENV ?? 'development',
    lastUpdate: process.env.NEXT_PUBLIC_LAST_UPDATE ?? 'January 15, 2026',
    adminEmail: process.env.ADMIN_EMAIL ?? '',
  })
}

// POST /api/admin/settings — validate current password for change operations
export async function POST(request: NextRequest) {
  const user = await getAuthorizedUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { action, currentPassword, newValue } = await request.json()

  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword || currentPassword !== adminPassword) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 })
  }

  // In a production environment, these would update the credential store.
  // For this thesis demo, we validate the current password and confirm the intent.
  if (action === 'change-email') {
    return NextResponse.json({
      success: true,
      message: `Email update to "${newValue}" validated. Update ADMIN_EMAIL in your environment to apply permanently.`,
    })
  }

  if (action === 'change-password') {
    return NextResponse.json({
      success: true,
      message: 'Password change validated. Update ADMIN_PASSWORD in your environment to apply permanently.',
    })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
