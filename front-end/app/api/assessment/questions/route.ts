import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

type QuestionType = 'identify' | 'perform'

const QUESTION_COLS =
  'question_id, level_id, question_type, question_text, video_url, option_a, option_b, option_c, option_d, correct_answer, correct_sign, points, created_at'

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const message = 'message' in error ? String(error.message).toLowerCase() : ''
  return message.includes('column') && message.includes('does not exist')
}

async function queryAssessmentQuestions(levelId: string, status: string) {
  const baseQuery = () =>
    supabaseAdmin
      .from('assessment_questions')
      .select(QUESTION_COLS)
      .eq('level_id', levelId)
      .order('created_at', { ascending: true })

  if (status === 'all') {
    return { result: await baseQuery(), statusFilterApplied: 'none' as const }
  }

  const byStatus = await baseQuery().eq('status', 'active')
  if (!byStatus.error) {
    return { result: byStatus, statusFilterApplied: 'status' as const }
  }

  if (!isMissingColumnError(byStatus.error)) {
    return { result: byStatus, statusFilterApplied: 'status' as const }
  }

  const byIsActive = await baseQuery().eq('is_active', true)
  if (!byIsActive.error) {
    return { result: byIsActive, statusFilterApplied: 'is_active' as const }
  }

  if (!isMissingColumnError(byIsActive.error)) {
    return { result: byIsActive, statusFilterApplied: 'is_active' as const }
  }

  return { result: await baseQuery(), statusFilterApplied: 'none' as const }
}

// GET /api/assessment/questions?levelId=xxx&status=active
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const levelId = searchParams.get('levelId')
  const status = (searchParams.get('status') ?? 'active').toLowerCase()

  if (!levelId) {
    return NextResponse.json({ error: 'levelId is required' }, { status: 400 })
  }

  try {
    const { result, statusFilterApplied } = await queryAssessmentQuestions(levelId, status)
    if (result.error) throw result.error

    const questions = (result.data ?? []).map((q) => ({
      id: q.question_id,
      levelId: q.level_id,
      type: (q.question_type ?? 'identify') as QuestionType,
      questionText: q.question_text ?? '',
      videoUrl: q.video_url ?? null,
      optionA: q.option_a ?? '',
      optionB: q.option_b ?? '',
      optionC: q.option_c ?? '',
      optionD: q.option_d ?? '',
      correctAnswer: q.correct_answer ?? '',
      correctSign: q.correct_sign ?? '',
      points: q.points ?? 0,
    }))

    return NextResponse.json({
      levelId,
      assessmentId: levelId,
      statusFilterRequested: status,
      statusFilterApplied,
      count: questions.length,
      questions,
    })
  } catch (err) {
    console.error('[assessment/questions GET]', err)
    return NextResponse.json({ error: 'Failed to fetch assessment questions' }, { status: 500 })
  }
}
