import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

function isAuthorized(request: NextRequest): boolean {
  const cookie = request.cookies.get('admin_auth')?.value
  const secret = process.env.ADMIN_AUTH_SECRET
  return !!(cookie && secret && cookie === secret)
}

type Mode = 'practice' | 'assessment'

const ORDER_COLUMN_CANDIDATES = ['question_order', 'sequence_order', 'display_order'] as const
type OrderColumn = (typeof ORDER_COLUMN_CANDIDATES)[number]

function getTable(mode: Mode) {
  return mode === 'practice' ? 'practice_questions' : 'assessment_questions'
}

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const message = 'message' in error ? String(error.message).toLowerCase() : ''
  return message.includes('column') && message.includes('does not exist')
}

async function detectOrderColumn(mode: Mode, levelId: string): Promise<OrderColumn | null> {
  const table = getTable(mode)

  for (const column of ORDER_COLUMN_CANDIDATES) {
    const { error } = await supabaseAdmin
      .from(table)
      .select('question_id')
      .eq('level_id', levelId)
      .order(column, { ascending: true })
      .limit(1)

    if (!error) return column
    if (!isMissingColumnError(error)) throw error
  }

  return null
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
    const table = getTable(mode)
    const orderColumn = await detectOrderColumn(mode, levelId)

    const baseQuery = supabaseAdmin
      .from(table)
      .select(cols)
      .eq('level_id', levelId)

    const { data, error } = orderColumn
      ? await baseQuery.order(orderColumn, { ascending: true })
      : await baseQuery.order('created_at', { ascending: true })

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
    const typedMode = mode as Mode
    const table = getTable(typedMode)
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

    const orderColumn = await detectOrderColumn(typedMode, levelId)
    const rawInsertAt = Number(body.insertAt)
    const hasRequestedPosition = Number.isFinite(rawInsertAt)

    if (orderColumn) {
      const { data: existingQuestions, error: existingError } = await supabaseAdmin
        .from(table)
        .select('question_id')
        .eq('level_id', levelId)
        .order(orderColumn, { ascending: true })

      if (existingError) throw existingError

      const existing = existingQuestions ?? []
      const targetPosition = Math.min(
        Math.max(hasRequestedPosition ? rawInsertAt : existing.length + 1, 1),
        existing.length + 1
      )

      for (let idx = targetPosition - 1; idx < existing.length; idx += 1) {
        const q = existing[idx]
        const { error: shiftError } = await supabaseAdmin
          .from(table)
          .update({ [orderColumn]: idx + 2 })
          .eq('question_id', q.question_id)

        if (shiftError) throw shiftError
      }

      insertData[orderColumn] = targetPosition
    }

    const { data, error } = await supabaseAdmin
      .from(table)
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

  if (Array.isArray(body.reorderIds)) {
    if (!mode || !body.levelId) {
      return NextResponse.json({ error: 'mode and levelId are required for reorder' }, { status: 400 })
    }

    try {
      const typedMode = mode as Mode
      const table = getTable(typedMode)
      const orderColumn = await detectOrderColumn(typedMode, body.levelId)

      if (!orderColumn) {
        return NextResponse.json(
          { error: 'Question ordering column not found. Add question_order column in database first.' },
          { status: 400 }
        )
      }

      for (let idx = 0; idx < body.reorderIds.length; idx += 1) {
        const questionId = body.reorderIds[idx]
        const { error } = await supabaseAdmin
          .from(table)
          .update({ [orderColumn]: idx + 1 })
          .eq('question_id', questionId)
          .eq('level_id', body.levelId)

        if (error) throw error
      }

      return NextResponse.json({ success: true })
    } catch (err) {
      console.error('[admin/questions PUT reorder]', err)
      return NextResponse.json({ error: 'Failed to reorder questions' }, { status: 500 })
    }
  }

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
