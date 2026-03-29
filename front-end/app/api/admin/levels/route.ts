import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

function isAuthorized(request: NextRequest): boolean {
  const cookie = request.cookies.get('admin_auth')?.value
  const secret = process.env.ADMIN_AUTH_SECRET
  return !!(cookie && secret && cookie === secret)
}

// POST /api/admin/levels — create a new empty level
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
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
