import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getAuthorizedAdmin } from '@/lib/adminAuth'

async function getAuthorizedUser(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.substring(7)
  const { data: user, error: authError } = await supabaseAdmin.auth.getUser(token)

  if (authError || !user || !user.user) {
    return null
  }

  const userId = user.user.id
  
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

// POST /api/admin/levels — create a new empty level
export async function POST(request: NextRequest) {
  const user = await getAuthorizedUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { level_name, sequence_order, passing_score } = await request.json()

  if (!level_name || sequence_order == null || passing_score == null) {
    return NextResponse.json(
      { error: 'level_name, sequence_order, and passing_score are required' },
      { status: 400 }
    )
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('levels')
      .insert({
        level_name,
        sequence_order,
        level_order: sequence_order,
        passing_score,
      })
      .select('level_id, level_name')
      .single()

    if (error) throw error

    return NextResponse.json({ level: data })
  } catch (err) {
    console.error('[admin/levels POST]', err)
    return NextResponse.json({ error: 'Failed to create level' }, { status: 500 })
  }
}
