import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'
import { getAuthorizedAdmin } from '@/lib/adminAuth'

// Route handler - dispatch based on URL
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  
  // Check if this is a request for listing videos
  if (url.pathname.includes('/api/admin/lessons') && url.searchParams.has('action') && url.searchParams.get('action') === 'list-videos') {
    return handleListVideos()
  }

  // Otherwise, handle as normal lessons GET
  const adminUser = await getAuthorizedAdmin(request)
  if (!adminUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const levelId = url.searchParams.get('levelId')
  if (!levelId) {
    return NextResponse.json({ error: 'levelId is required' }, { status: 400 })
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('lessons')
      .select('lesson_id, lesson_title, video_url, content_text, lesson_order, lesson_title_tagalog, content_text_tagalog')
      .eq('level_id', levelId)
      .order('lesson_order', { ascending: true })

    if (error) throw error

    return NextResponse.json({ lessons: data ?? [] })
  } catch (err) {
    console.error('[admin/lessons GET]', err)
    return NextResponse.json({ error: 'Failed to fetch lessons' }, { status: 500 })
  }
}

// Helper function to list videos from storage
async function handleListVideos() {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[list-videos] Missing Supabase configuration')
      return NextResponse.json(
        { videos: [] },
        { status: 200 }
      )
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    console.log('[list-videos] Listing videos from lessons-videos bucket...')

    const { data, error } = await supabase.storage
      .from('lessons-videos')
      .list('', { limit: 100, sortBy: { column: 'name', order: 'asc' } })

    if (error) {
      console.error('[list-videos] Error:', error)
      return NextResponse.json({ videos: [] })
    }

    if (!data) {
      console.log('[list-videos] No data returned')
      return NextResponse.json({ videos: [] })
    }

    console.log('[list-videos] Got', data.length, 'items from bucket')

    const videos = data
      .filter(file => {
        const name = file.name.toLowerCase()
        return name.endsWith('.mp4') || name.endsWith('.mp44') || 
               name.endsWith('.mov') || name.endsWith('.webm') ||
               name.endsWith('.avi') || name.endsWith('.mkv')
      })
      .map(file => file.name.replace(/\.(mp4|mp44|mov|webm|avi|mkv)$/i, ''))
      .sort()

    console.log('[list-videos] Returning', videos.length, 'videos')
    return NextResponse.json({ videos })
  } catch (err) {
    console.error('[list-videos] Error:', err)
    return NextResponse.json({ videos: [] })
  }
}

async function shiftLessonOrdersForInsert(levelId: string, order: number) {
  const { data, error } = await supabaseAdmin
    .from('lessons')
    .select('lesson_id, lesson_order')
    .eq('level_id', levelId)
    .gte('lesson_order', order)
    .order('lesson_order', { ascending: true })

  if (error) throw error

  let nextOrder = order
  for (const lesson of data ?? []) {
    const currentOrder = lesson.lesson_order ?? 0
    if (currentOrder < nextOrder) continue
    if (currentOrder > nextOrder) break

    const { error: updateError } = await supabaseAdmin
      .from('lessons')
      .update({ lesson_order: nextOrder + 1 })
      .eq('lesson_id', lesson.lesson_id)
    if (updateError) throw updateError

    nextOrder += 1
  }
}

async function shiftLessonOrdersForUpdate(levelId: string, currentOrder: number, newOrder: number, lessonId: string) {
  if (newOrder === currentOrder) return

  if (newOrder < currentOrder) {
    const { data, error } = await supabaseAdmin
      .from('lessons')
      .select('lesson_id, lesson_order')
      .eq('level_id', levelId)
      .gte('lesson_order', newOrder)
      .lt('lesson_order', currentOrder)
      .order('lesson_order', { ascending: false })

    if (error) throw error

    for (const lesson of data ?? []) {
      const nextOrder = (lesson.lesson_order ?? 0) + 1
      const { error: updateError } = await supabaseAdmin
        .from('lessons')
        .update({ lesson_order: nextOrder })
        .eq('lesson_id', lesson.lesson_id)
      if (updateError) throw updateError
    }
  } else {
    const { data, error } = await supabaseAdmin
      .from('lessons')
      .select('lesson_id, lesson_order')
      .eq('level_id', levelId)
      .gt('lesson_order', currentOrder)
      .lte('lesson_order', newOrder)
      .order('lesson_order', { ascending: true })

    if (error) throw error

    for (const lesson of data ?? []) {
      const nextOrder = (lesson.lesson_order ?? 0) - 1
      const { error: updateError } = await supabaseAdmin
        .from('lessons')
        .update({ lesson_order: nextOrder })
        .eq('lesson_id', lesson.lesson_id)
      if (updateError) throw updateError
    }
  }
}

// POST /api/admin/lessons — create lesson
export async function POST(request: NextRequest) {
  const adminUser = await getAuthorizedAdmin(request)
  if (!adminUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { levelId, lesson_title, video_url, content_text, lesson_order, lesson_title_tagalog, content_text_tagalog } = await request.json()

  if (!levelId || !lesson_title) {
    return NextResponse.json({ error: 'levelId and lesson_title are required' }, { status: 400 })
  }

  const order = typeof lesson_order === 'number' && lesson_order > 0 ? lesson_order : undefined

  try {
    if (order != null) {
      await shiftLessonOrdersForInsert(levelId, order)
    }

    const insertData: Record<string, unknown> = {
      level_id: levelId,
      lesson_title,
      video_url,
      content_text,
      lesson_title_tagalog,
      content_text_tagalog,
    }
    if (order != null) insertData.lesson_order = order

    const { data, error } = await supabaseAdmin
      .from('lessons')
      .insert(insertData)
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
  const adminUser = await getAuthorizedAdmin(request)
  if (!adminUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id, lesson_title, video_url, content_text, lesson_order, lesson_title_tagalog, content_text_tagalog } = await request.json()

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  try {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('lessons')
      .select('lesson_id, level_id, lesson_order')
      .eq('lesson_id', id)
      .single()

    if (existingError) throw existingError
    if (!existing) {
      return NextResponse.json({ error: 'Lesson not found' }, { status: 404 })
    }

    const newOrder = typeof lesson_order === 'number' ? lesson_order : existing.lesson_order
    if (typeof newOrder === 'number' && typeof existing.lesson_order === 'number' && newOrder !== existing.lesson_order) {
      await shiftLessonOrdersForUpdate(existing.level_id, existing.lesson_order, newOrder, id)
    }

    const updateData: Record<string, unknown> = {
      lesson_title,
      video_url,
      content_text,
      lesson_title_tagalog,
      content_text_tagalog,
    }
    if (typeof lesson_order === 'number') updateData.lesson_order = lesson_order

    const { data, error } = await supabaseAdmin
      .from('lessons')
      .update(updateData)
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
  const adminUser = await getAuthorizedAdmin(request)
  if (!adminUser) {
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
