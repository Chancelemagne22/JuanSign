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

// PUT /api/admin/levels — update an existing level title and/or sequence order
export async function PUT(request: NextRequest) {
  const user = await getAuthorizedUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { level_id, level_name, sequence_order } = await request.json()
  if (!level_id) {
    return NextResponse.json({ error: 'level_id is required' }, { status: 400 })
  }

  const updateData: Record<string, unknown> = {}
  if (level_name) updateData.level_name = level_name
  if (sequence_order != null) {
    updateData.sequence_order = sequence_order
    updateData.level_order = sequence_order
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: 'At least one field to update is required' }, { status: 400 })
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('levels')
      .update(updateData)
      .eq('level_id', level_id)
      .select('level_id, level_name, sequence_order, level_order')
      .single()

    if (error) throw error
    return NextResponse.json({ level: data })
  } catch (err) {
    console.error('[admin/levels PUT]', err)
    return NextResponse.json({ error: 'Failed to update level' }, { status: 500 })
  }
}

// DELETE /api/admin/levels — remove a level
export async function DELETE(request: NextRequest) {
  const user = await getAuthorizedUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { level_id } = await request.json()
  if (!level_id) {
    return NextResponse.json({ error: 'level_id is required' }, { status: 400 })
  }

  try {
    const { error } = await supabaseAdmin
      .from('levels')
      .delete()
      .eq('level_id', level_id)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[admin/levels DELETE]', err)
    return NextResponse.json({ error: 'Failed to delete level' }, { status: 500 })
  }
}
