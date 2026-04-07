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

function dateFilter(days: string): string | null {
  if (days === 'all') return null
  const d = parseInt(days)
  const since = new Date(Date.now() - d * 24 * 60 * 60 * 1000)
  return since.toISOString()
}

export interface LevelPerformanceRow {
  levelId: string
  levelName: string
  learnersAttempted: number
  completionRate: number
  avgScore: number
  passRate: number
}

export interface LearnerPerformanceRow {
  username: string
  currentLevel: string
  attempts: number
  latestScore: number
  status: 'Passed' | 'Failed'
}

export interface CommonlyMissedRow {
  sign: string
  percentIncorrect: number
}

export interface ReportStats {
  assessmentsTaken: number
  avgAccuracy: number
  completionRate: number
  highestLevel: string
}

export interface ReportData {
  stats: ReportStats
  levelPerformance: LevelPerformanceRow[]
  learnerPerformance: LearnerPerformanceRow[]
  commonlyMissed: CommonlyMissedRow[]
}

export async function GET(request: NextRequest) {
  const user = await getAuthorizedUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const levelId = searchParams.get('levelId') ?? 'all'
  const dateRange = searchParams.get('dateRange') ?? 'all'
  const status = searchParams.get('status') ?? 'all'

  const since = dateFilter(dateRange)

  try {
    // ── Build base query for assessment_results ───────────────────────
    let query = supabaseAdmin
      .from('assessment_results')
      .select('result_id, auth_user_id, level_id, score, is_passed, attempt_date')

    if (levelId !== 'all') query = query.eq('level_id', levelId)
    if (since) query = query.gte('attempt_date', since)
    if (status === 'completed') query = query.eq('is_passed', true)
    else if (status === 'failed') query = query.eq('is_passed', false)

    const { data: results } = await query.order('attempt_date', { ascending: false })
    const allResults = results ?? []

    // ── Fetch supporting data ─────────────────────────────────────────
    const [
      { data: levels },
      { data: profiles },
      { data: practiceSessions },
      { data: totalProfiles },
    ] = await Promise.all([
      supabaseAdmin.from('levels').select('level_id, level_name'),
      supabaseAdmin
        .from('profiles')
        .select('auth_user_id, username, first_name, last_name'),
      supabaseAdmin
        .from('practice_sessions')
        .select('auth_user_id, level_id, average_accuracy, session_date')
        .order('session_date', { ascending: false }),
      supabaseAdmin
        .from('profiles')
        .select('auth_user_id', { count: 'exact', head: false }),
    ])

    const levelsMap = new Map((levels ?? []).map((l) => [l.level_id, l.level_name]))

    // ── Stats ─────────────────────────────────────────────────────────
    const assessmentsTaken = allResults.length
    const avgAccuracy =
      assessmentsTaken > 0
        ? Math.round(allResults.reduce((s, r) => s + (r.score ?? 0), 0) / assessmentsTaken)
        : 0

    const totalUsers = (totalProfiles ?? []).length
    const usersWithPass = new Set(
      allResults.filter((r) => r.is_passed).map((r) => r.auth_user_id)
    ).size
    const completionRate =
      totalUsers > 0 ? Math.round((usersWithPass / totalUsers) * 100) : 0

    // Highest completed level — parse number from name, pick max
    const passedLevelNames = allResults
      .filter((r) => r.is_passed)
      .map((r) => levelsMap.get(r.level_id) ?? '')
      .filter(Boolean)
    const highestLevel =
      passedLevelNames.length > 0
        ? passedLevelNames.reduce((best, name) => {
            const n = parseInt(name.replace(/\D/g, '')) || 0
            const b = parseInt(best.replace(/\D/g, '')) || 0
            return n > b ? name : best
          }, passedLevelNames[0])
        : 'N/A'

    // ── Level Performance Table ───────────────────────────────────────
    const levelGroups = new Map<string, typeof allResults>()
    for (const r of allResults) {
      const group = levelGroups.get(r.level_id) ?? []
      group.push(r)
      levelGroups.set(r.level_id, group)
    }

    // If no filter applied, also include levels that only have practice data
    const levelIds =
      levelId === 'all'
        ? [...new Set([...levelGroups.keys(), ...(levels ?? []).map((l) => l.level_id)])]
        : [levelId]

    const levelPerformance: LevelPerformanceRow[] = levelIds
      .map((lid) => {
        const rows = levelGroups.get(lid) ?? []
        const learnersAttempted = new Set(rows.map((r) => r.auth_user_id)).size
        const passed = rows.filter((r) => r.is_passed).length
        const passRate = rows.length > 0 ? Math.round((passed / rows.length) * 100) : 0
        const avgScore =
          rows.length > 0
            ? Math.round(rows.reduce((s, r) => s + (r.score ?? 0), 0) / rows.length)
            : 0
        // Completion rate per level = % of learners who passed at least once
        const usersWhoPassedLevel = new Set(
          rows.filter((r) => r.is_passed).map((r) => r.auth_user_id)
        ).size
        const completionRateLevel =
          learnersAttempted > 0
            ? Math.round((usersWhoPassedLevel / learnersAttempted) * 100)
            : 0

        return {
          levelId: lid,
          levelName: levelsMap.get(lid) ?? 'Unknown',
          learnersAttempted,
          completionRate: completionRateLevel,
          avgScore,
          passRate,
        }
      })
      .filter((r) => r.learnersAttempted > 0)
      .sort((a, b) => a.levelName.localeCompare(b.levelName))

    // ── Learner Performance Table ─────────────────────────────────────
    const userResultsMap = new Map<string, typeof allResults>()
    for (const r of allResults) {
      const arr = userResultsMap.get(r.auth_user_id) ?? []
      arr.push(r)
      userResultsMap.set(r.auth_user_id, arr)
    }

    const learnerPerformance: LearnerPerformanceRow[] = Array.from(
      userResultsMap.entries()
    ).map(([userId, rows]) => {
      const profile = (profiles ?? []).find((p) => p.auth_user_id === userId)
      const name =
        profile
          ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() ||
            profile.username
          : 'Unknown'
      const sorted = [...rows].sort(
        (a, b) => new Date(b.attempt_date).getTime() - new Date(a.attempt_date).getTime()
      )
      const latest = sorted[0]
      // Current level = most recent activity level
      const currentLevel = levelsMap.get(latest.level_id) ?? 'N/A'
      const hasPassed = rows.some((r) => r.is_passed)

      return {
        username: name,
        currentLevel,
        attempts: rows.length,
        latestScore: latest.score ?? 0,
        status: hasPassed ? 'Passed' : 'Failed',
      }
    })

    // ── Commonly Missed Signs ─────────────────────────────────────────
    // Derive from practice_sessions: levels where avg accuracy is lowest
    const practiceByLevel = new Map<string, number[]>()
    for (const s of practiceSessions ?? []) {
      if (levelId !== 'all' && s.level_id !== levelId) continue
      if (since && new Date(s.session_date) < new Date(since)) continue
      const arr = practiceByLevel.get(s.level_id) ?? []
      arr.push(s.average_accuracy ?? 0)
      practiceByLevel.set(s.level_id, arr)
    }

    const commonlyMissed: CommonlyMissedRow[] = Array.from(practiceByLevel.entries())
      .map(([lid, scores]) => {
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length
        return {
          sign: levelsMap.get(lid) ?? 'Unknown',
          percentIncorrect: Math.round(100 - avg),
        }
      })
      .filter((r) => r.percentIncorrect > 0)
      .sort((a, b) => b.percentIncorrect - a.percentIncorrect)
      .slice(0, 5)

    const data: ReportData = {
      stats: { assessmentsTaken, avgAccuracy, completionRate, highestLevel },
      levelPerformance,
      learnerPerformance,
      commonlyMissed,
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('[admin/reports]', err)
    return NextResponse.json({ error: 'Failed to fetch report data' }, { status: 500 })
  }
}
