import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

function isAuthorized(request: NextRequest): boolean {
  const cookie = request.cookies.get('admin_auth')?.value
  const secret = process.env.ADMIN_AUTH_SECRET
  return !!(cookie && secret && cookie === secret)
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // ── Recently Active Users ─────────────────────────────────────────
    const [{ data: recentPractice }, { data: recentAssessment }] = await Promise.all([
      supabaseAdmin
        .from('practice_sessions')
        .select('auth_user_id, session_date, level_id')
        .order('session_date', { ascending: false })
        .limit(100),
      supabaseAdmin
        .from('assessment_results')
        .select('auth_user_id, attempt_date, level_id')
        .order('attempt_date', { ascending: false })
        .limit(100),
    ])

    // Merge: keep only the latest activity + level per user
    const activityMap = new Map<string, { timestamp: string; levelId: string }>()
    for (const r of [...(recentPractice ?? []), ...(recentAssessment ?? [])]) {
      const timestamp = (r as { session_date?: string; attempt_date?: string }).session_date ?? (r as { attempt_date?: string }).attempt_date ?? ''
      const existing = activityMap.get(r.auth_user_id)
      if (!existing || new Date(timestamp) > new Date(existing.timestamp)) {
        activityMap.set(r.auth_user_id, { timestamp, levelId: r.level_id })
      }
    }

    const sortedActive = Array.from(activityMap.entries())
      .sort((a, b) => new Date(b[1].timestamp).getTime() - new Date(a[1].timestamp).getTime())
      .slice(0, 10)

    const activeUserIds = sortedActive.map(([id]) => id)
    const activeLevelIds = [...new Set(sortedActive.map(([, d]) => d.levelId).filter(Boolean))]

    const [{ data: activeProfiles }, { data: activeLevels }] = await Promise.all([
      activeUserIds.length
        ? supabaseAdmin
            .from('profiles')
            .select('auth_user_id, username, first_name, last_name')
            .in('auth_user_id', activeUserIds)
        : Promise.resolve({ data: [] }),
      activeLevelIds.length
        ? supabaseAdmin.from('levels').select('level_id, level_name').in('level_id', activeLevelIds)
        : Promise.resolve({ data: [] }),
    ])

    const recentlyActiveUsers = sortedActive.map(([userId, data]) => {
      const profile = activeProfiles?.find((p) => p.auth_user_id === userId)
      const level = activeLevels?.find((l) => l.level_id === data.levelId)
      const fullName =
        profile
          ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.username
          : 'Unknown User'
      return {
        username: fullName,
        currentLevel: level?.level_name ?? 'N/A',
        lastActivity: data.timestamp,
      }
    })

    // ── Recently Completed Levels ──────────────────────────────────────
    const { data: completedRaw } = await supabaseAdmin
      .from('assessment_results')
      .select('auth_user_id, level_id, attempt_date')
      .eq('is_passed', true)
      .order('attempt_date', { ascending: false })
      .limit(10)

    const completedUserIds = [...new Set(completedRaw?.map((r) => r.auth_user_id) ?? [])]
    const completedLevelIds = [...new Set(completedRaw?.map((r) => r.level_id) ?? [])]

    const [{ data: completedProfiles }, { data: completedLevelNames }] = await Promise.all([
      completedUserIds.length
        ? supabaseAdmin
            .from('profiles')
            .select('auth_user_id, username, first_name, last_name')
            .in('auth_user_id', completedUserIds)
        : Promise.resolve({ data: [] }),
      completedLevelIds.length
        ? supabaseAdmin.from('levels').select('level_id, level_name').in('level_id', completedLevelIds)
        : Promise.resolve({ data: [] }),
    ])

    const recentlyCompletedLevels = (completedRaw ?? []).map((r) => {
      const profile = completedProfiles?.find((p) => p.auth_user_id === r.auth_user_id)
      const level = completedLevelNames?.find((l) => l.level_id === r.level_id)
      const fullName =
        profile
          ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.username
          : 'Unknown User'
      return {
        username: fullName,
        levelCompleted: level?.level_name ?? 'N/A',
        dateCompleted: r.attempt_date,
      }
    })

    return NextResponse.json({ recentlyActiveUsers, recentlyCompletedLevels })
  } catch (error) {
    console.error('[admin/dashboard]', error)
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 })
  }
}
