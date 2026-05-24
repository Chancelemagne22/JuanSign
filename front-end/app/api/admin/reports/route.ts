import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
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
  authUserId: string
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

export interface LearnerOption {
  authUserId: string
  name: string
  email: string
}

export interface IndividualLevelPerformanceRow {
  levelId: string
  levelName: string
  attempts: number
  avgScore: number
  bestScore: number
  latestScore: number
  status: 'Passed' | 'Failed'
}

export interface IndividualAssessmentHistoryRow {
  attemptDate: string
  levelName: string
  score: number
  starsEarned: number
  timeTakenSeconds: number
  status: 'Passed' | 'Failed'
}

export interface IndividualReport {
  learner: {
    authUserId: string
    name: string
    email: string
    currentLevel: string
  }
  stats: {
    attempts: number
    avgScore: number
    passRate: number
    latestScore: number
    latestStatus: 'Passed' | 'Failed' | 'N/A'
    highestCompletedLevel: string
  }
  levelPerformance: IndividualLevelPerformanceRow[]
  assessmentHistory: IndividualAssessmentHistoryRow[]
  commonlyMissed: CommonlyMissedRow[]
}

export interface ReportData {
  stats: ReportStats
  levelPerformance: LevelPerformanceRow[]
  learnerPerformance: LearnerPerformanceRow[]
  commonlyMissed: CommonlyMissedRow[]
  learnerOptions: LearnerOption[]
  individualReport: IndividualReport | null
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
  const learnerId = searchParams.get('learnerId') ?? 'all'

  const since = dateFilter(dateRange)

  try {
    // ── Build base query for assessment_results ───────────────────────
    let query = supabaseAdmin
      .from('assessment_results')
      .select('result_id, auth_user_id, level_id, score, stars_earned, time_taken_seconds, is_passed, attempt_date')

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
      { data: { users: authUsers } },
    ] = await Promise.all([
      supabaseAdmin.from('levels').select('level_id, level_name'),
      supabaseAdmin
        .from('profiles')
        .select('auth_user_id, username, first_name, last_name, role'),
      supabaseAdmin
        .from('practice_sessions')
        .select('auth_user_id, level_id, session_date, is_correct, target_sign')
        .order('session_date', { ascending: false }),
      supabaseAdmin
        .from('profiles')
        .select('auth_user_id', { count: 'exact', head: false }),
      supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }),
    ])

    const levelsMap = new Map((levels ?? []).map((l) => [l.level_id, l.level_name]))
    const authEmailMap = new Map((authUsers ?? []).map((u) => [u.id, u.email ?? 'N/A']))

    const getProfileName = (profile: {
      username: string | null
      first_name: string | null
      last_name: string | null
    } | undefined) =>
      profile
        ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() ||
          profile.username ||
          'Unknown'
        : 'Unknown'

    const getHighestCompletedLevel = (rows: typeof allResults) => {
      const names = rows
        .filter((r) => r.is_passed)
        .map((r) => levelsMap.get(r.level_id) ?? '')
        .filter(Boolean)

      return names.length > 0
        ? names.reduce((best, name) => {
            const n = parseInt(name.replace(/\D/g, '')) || 0
            const b = parseInt(best.replace(/\D/g, '')) || 0
            return n > b ? name : best
          }, names[0])
        : 'N/A'
    }

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
    const highestLevel = getHighestCompletedLevel(allResults)

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
      const name = getProfileName(profile)
      const sorted = [...rows].sort(
        (a, b) => new Date(b.attempt_date).getTime() - new Date(a.attempt_date).getTime()
      )
      const latest = sorted[0]
      // Current level = most recent activity level
      const currentLevel = levelsMap.get(latest.level_id) ?? 'N/A'
      const hasPassed = rows.some((r) => r.is_passed)

      return {
        authUserId: userId,
        username: name,
        currentLevel,
        attempts: rows.length,
        latestScore: latest.score ?? 0,
        status: hasPassed ? 'Passed' : 'Failed',
      }
    })

    const learnerOptions: LearnerOption[] = (profiles ?? [])
      .filter((profile) => profile.role === 'student')
      .map((profile) => ({
        authUserId: profile.auth_user_id,
        name: getProfileName(profile),
        email: authEmailMap.get(profile.auth_user_id) ?? 'N/A',
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    // ── Commonly Missed Signs ─────────────────────────────────────────
    const missedMap = new Map<string, { total: number; incorrect: number }>()

    for (const s of practiceSessions ?? []) {
      if (levelId !== 'all' && s.level_id !== levelId) continue
      if (since && new Date(s.session_date) < new Date(since)) continue
      if (!s.target_sign || s.target_sign.trim() === '') continue
      if (s.is_correct === null || s.is_correct === undefined) continue

      const sign = s.target_sign.trim()
      const entry = missedMap.get(sign) ?? { total: 0, incorrect: 0 }
      entry.total += 1
      if (!s.is_correct) entry.incorrect += 1
      missedMap.set(sign, entry)
    }

    const commonlyMissed: CommonlyMissedRow[] = Array.from(missedMap.entries())
      .map(([sign, { total, incorrect }]) => ({
        sign,
        percentIncorrect: total > 0 ? Math.round((incorrect / total) * 100) : 0,
      }))
      .filter((r) => r.percentIncorrect > 0)
      .sort((a, b) => b.percentIncorrect - a.percentIncorrect)
      .slice(0, 5)

    let individualReport: IndividualReport | null = null

    if (learnerId !== 'all') {
      const learnerProfile = (profiles ?? []).find((p) => p.auth_user_id === learnerId)
      const learnerRows = allResults.filter((r) => r.auth_user_id === learnerId)
      const sortedLearnerRows = [...learnerRows].sort(
        (a, b) => new Date(b.attempt_date).getTime() - new Date(a.attempt_date).getTime()
      )
      const latest = sortedLearnerRows[0]
      const passedRows = learnerRows.filter((r) => r.is_passed)
      const avgScore =
        learnerRows.length > 0
          ? Math.round(learnerRows.reduce((sum, r) => sum + (r.score ?? 0), 0) / learnerRows.length)
          : 0
      const passRate =
        learnerRows.length > 0 ? Math.round((passedRows.length / learnerRows.length) * 100) : 0

      const learnerLevelGroups = new Map<string, typeof learnerRows>()
      for (const row of learnerRows) {
        const group = learnerLevelGroups.get(row.level_id) ?? []
        group.push(row)
        learnerLevelGroups.set(row.level_id, group)
      }

      const individualLevelPerformance: IndividualLevelPerformanceRow[] = Array.from(
        learnerLevelGroups.entries()
      )
        .map(([lid, rows]) => {
          const sortedRows = [...rows].sort(
            (a, b) => new Date(b.attempt_date).getTime() - new Date(a.attempt_date).getTime()
          )
          const latestRow = sortedRows[0]
          const scores = rows.map((r) => r.score ?? 0)

          return {
            levelId: lid,
            levelName: levelsMap.get(lid) ?? 'Unknown',
            attempts: rows.length,
            avgScore: Math.round(scores.reduce((sum, score) => sum + score, 0) / rows.length),
            bestScore: Math.max(...scores),
            latestScore: latestRow.score ?? 0,
            status: rows.some((r) => r.is_passed) ? 'Passed' as const : 'Failed' as const,
          }
        })
        .sort((a, b) => a.levelName.localeCompare(b.levelName))

      const assessmentHistory: IndividualAssessmentHistoryRow[] = sortedLearnerRows.map((row) => ({
        attemptDate: row.attempt_date,
        levelName: levelsMap.get(row.level_id) ?? 'Unknown',
        score: row.score ?? 0,
        starsEarned: row.stars_earned ?? 0,
        timeTakenSeconds: row.time_taken_seconds ?? 0,
        status: row.is_passed ? 'Passed' : 'Failed',
      }))

      const individualMissedMap = new Map<string, { total: number; incorrect: number }>()
      for (const session of practiceSessions ?? []) {
        if (session.auth_user_id !== learnerId) continue
        if (levelId !== 'all' && session.level_id !== levelId) continue
        if (since && new Date(session.session_date) < new Date(since)) continue
        if (!session.target_sign || session.target_sign.trim() === '') continue
        if (session.is_correct === null || session.is_correct === undefined) continue

        const sign = session.target_sign.trim()
        const entry = individualMissedMap.get(sign) ?? { total: 0, incorrect: 0 }
        entry.total += 1
        if (!session.is_correct) entry.incorrect += 1
        individualMissedMap.set(sign, entry)
      }

      const individualCommonlyMissed: CommonlyMissedRow[] = Array.from(individualMissedMap.entries())
        .map(([sign, { total, incorrect }]) => ({
          sign,
          percentIncorrect: total > 0 ? Math.round((incorrect / total) * 100) : 0,
        }))
        .filter((r) => r.percentIncorrect > 0)
        .sort((a, b) => b.percentIncorrect - a.percentIncorrect)
        .slice(0, 5)

      individualReport = {
        learner: {
          authUserId: learnerId,
          name: getProfileName(learnerProfile),
          email: authEmailMap.get(learnerId) ?? 'N/A',
          currentLevel: latest ? levelsMap.get(latest.level_id) ?? 'N/A' : 'N/A',
        },
        stats: {
          attempts: learnerRows.length,
          avgScore,
          passRate,
          latestScore: latest?.score ?? 0,
          latestStatus: latest ? (latest.is_passed ? 'Passed' : 'Failed') : 'N/A',
          highestCompletedLevel: getHighestCompletedLevel(learnerRows),
        },
        levelPerformance: individualLevelPerformance,
        assessmentHistory,
        commonlyMissed: individualCommonlyMissed,
      }
    }

    const data: ReportData = {
      stats: { assessmentsTaken, avgAccuracy, completionRate, highestLevel },
      levelPerformance,
      learnerPerformance,
      commonlyMissed,
      learnerOptions,
      individualReport,
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('[admin/reports]', err)
    return NextResponse.json({ error: 'Failed to fetch report data' }, { status: 500 })
  }
}
