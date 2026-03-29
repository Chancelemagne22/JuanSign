import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

function isAuthorized(request: NextRequest): boolean {
  const cookie = request.cookies.get('admin_auth')?.value
  const secret = process.env.ADMIN_AUTH_SECRET
  return !!(cookie && secret && cookie === secret)
}

type Mode = 'practice' | 'assessment'

function getTable(mode: Mode) {
  return mode === 'practice' ? 'practice_questions' : 'assessment_questions'
}

const PRACTICE_COLS = 'question_id, question_type, question_text, video_url, option_a, option_b, option_c, option_d, correct_answer, target_sign, reference_data'
const ASSESSMENT_COLS = 'question_id, question_type, question_text, video_url, option_a, option_b, option_c, option_d, correct_answer, correct_sign, points'

// GET /api/admin/questions?mode=practice&levelId=xxx
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const mode = (searchParams.get('mode') ?? 'practice') as Mode
  const levelId = searchParams.get('levelId')

  if (!levelId) {
    return NextResponse.json({ error: 'levelId is required' }, { status: 400 })
  }

  try {
    const cols = mode === 'practice' ? PRACTICE_COLS : ASSESSMENT_COLS
    const { data, error } = await supabaseAdmin
      .from(getTable(mode))
      .select(cols)
      .eq('level_id', levelId)
      .order('created_at', { ascending: true })

    if (error) throw error

    return NextResponse.json({ questions: data ?? [] })
  } catch (err) {
    console.error('[admin/questions GET]', err)
    return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
  }
}

// POST /api/admin/questions — insert new question
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { mode, levelId } = body

  if (!mode || !levelId) {
    return NextResponse.json({ error: 'mode and levelId are required' }, { status: 400 })
  }

  const { question_type, question_text, video_url, option_a, option_b, option_c, option_d, correct_answer } = body

  try {
    let insertData: Record<string, unknown> = {
      level_id: levelId,
      question_type: question_type ?? 'identify',
      question_text,
    }

    if (question_type === 'identify') {
      insertData = { ...insertData, video_url, option_a, option_b, option_c, option_d, correct_answer }
    } else {
      // perform type
      if (mode === 'practice') {
        insertData = { ...insertData, target_sign: body.target_sign, reference_data: body.reference_data }
      } else {
        insertData = { ...insertData, correct_sign: body.correct_sign, points: body.points }
      }
    }

    // assessment always has points
    if (mode === 'assessment' && body.points != null) {
      insertData.points = body.points
    }

    const { data, error } = await supabaseAdmin
      .from(getTable(mode as Mode))
      .insert(insertData)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ question: data })
  } catch (err) {
    console.error('[admin/questions POST]', err)
    return NextResponse.json({ error: 'Failed to create question' }, { status: 500 })
  }
}

// PUT /api/admin/questions — update existing question
export async function PUT(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { mode, id, question_type, question_text, video_url, option_a, option_b, option_c, option_d, correct_answer } = body

  if (!mode || !id) {
    return NextResponse.json({ error: 'mode and id are required' }, { status: 400 })
  }

  try {
    let updateData: Record<string, unknown> = { question_type, question_text }

    if (question_type === 'identify') {
      updateData = { ...updateData, video_url, option_a, option_b, option_c, option_d, correct_answer }
    } else {
      if (mode === 'practice') {
        updateData = { ...updateData, target_sign: body.target_sign, reference_data: body.reference_data }
      } else {
        updateData = { ...updateData, correct_sign: body.correct_sign }
      }
    }

    if (mode === 'assessment' && body.points != null) {
      updateData.points = body.points
    }

    const { data, error } = await supabaseAdmin
      .from(getTable(mode as Mode))
      .update(updateData)
      .eq('question_id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ question: data })
  } catch (err) {
    console.error('[admin/questions PUT]', err)
    return NextResponse.json({ error: 'Failed to update question' }, { status: 500 })
  }
}

// DELETE /api/admin/questions?mode=practice&id=xxx
export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const mode = (searchParams.get('mode') ?? 'practice') as Mode
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  try {
    const { error } = await supabaseAdmin.from(getTable(mode)).delete().eq('question_id', id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[admin/questions DELETE]', err)
    return NextResponse.json({ error: 'Failed to delete question' }, { status: 500 })
  }
}
