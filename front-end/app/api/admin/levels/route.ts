import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'
// V-6: single source of truth (role + disabled/archived enforcement lives there).
import { getAuthorizedAdmin } from '@/lib/adminAuth'

// POST /api/admin/levels — create a new empty level
export async function POST(request: NextRequest) {
  const user = await getAuthorizedAdmin(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { level_name, sequence_order, passing_score, category } = await request.json()

  if (!level_name || sequence_order == null || passing_score == null || !category) {
    return NextResponse.json(
      { error: 'level_name, sequence_order, passing_score, and category are required' },
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
        category,
      })
      .select('level_id, level_name, category')
      .single()

    if (error) throw error

    return NextResponse.json({ level: data })
  } catch (err) {
    logger.error('admin/levels', 'create_failed', { reason: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Failed to create level' }, { status: 500 })
  }
}

// PUT /api/admin/levels — update an existing level title and/or sequence order
export async function PUT(request: NextRequest) {
  const user = await getAuthorizedAdmin(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { level_id, level_name, sequence_order, category } = await request.json()
  if (!level_id) {
    return NextResponse.json({ error: 'level_id is required' }, { status: 400 })
  }

  const updateData: Record<string, unknown> = {}
  if (level_name) updateData.level_name = level_name
  if (sequence_order != null) {
    updateData.sequence_order = sequence_order
    updateData.level_order = sequence_order
  }
  if (category) updateData.category = category

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
    logger.error('admin/levels', 'update_failed', { reason: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Failed to update level' }, { status: 500 })
  }
}

// DELETE /api/admin/levels — remove a level
export async function DELETE(request: NextRequest) {
  const user = await getAuthorizedAdmin(request)
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
    logger.error('admin/levels', 'delete_failed', { reason: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Failed to delete level' }, { status: 500 })
  }
}
