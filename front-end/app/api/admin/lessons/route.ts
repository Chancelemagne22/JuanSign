import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

function isAuthorized(request: NextRequest): boolean {
  const cookie = request.cookies.get('admin_auth')?.value
  const secret = process.env.ADMIN_AUTH_SECRET
  return !!(cookie && secret && cookie === secret)
}

// GET /api/admin/lessons?levelId=xxx
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const levelId = new URL(request.url).searchParams.get('levelId')
  if (!levelId) {
    return NextResponse.json({ error: 'levelId is required' }, { status: 400 })
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('lessons')
      .select('lesson_id, lesson_title, video_url, content_text, lesson_order')
      .eq('level_id', levelId)
      .order('lesson_order', { ascending: true })

    if (error) throw error

    return NextResponse.json({ lessons: data ?? [] })
  } catch (err) {
    console.error('[admin/lessons GET]', err)
    return NextResponse.json({ error: 'Failed to fetch lessons' }, { status: 500 })
  }
}

// POST /api/admin/lessons — create lesson
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { levelId, lesson_title, video_url, content_text, lesson_order } = await request.json()

  if (!levelId || !lesson_title) {
    return NextResponse.json({ error: 'levelId and lesson_title are required' }, { status: 400 })
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('lessons')
      .insert({ level_id: levelId, lesson_title, video_url, content_text, lesson_order })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ lesson: data })
  } catch (err) {
    console.error('[admin/lessons POST]', err)
    return NextResponse.json({ error: 'Failed to create lesson' }, { status: 500 })
  }
}

// PUT /api/admin/lessons — update lesson
export async function PUT(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id, lesson_title, video_url, content_text, lesson_order } = await request.json()

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('lessons')
      .update({ lesson_title, video_url, content_text, lesson_order })
      .eq('lesson_id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ lesson: data })
  } catch (err) {
    console.error('[admin/lessons PUT]', err)
    return NextResponse.json({ error: 'Failed to update lesson' }, { status: 500 })
  }
}

// DELETE /api/admin/lessons?id=xxx
export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = new URL(request.url).searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  try {
    const { error } = await supabaseAdmin.from('lessons').delete().eq('lesson_id', id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[admin/lessons DELETE]', err)
    return NextResponse.json({ error: 'Failed to delete lesson' }, { status: 500 })
  }
}
