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
    // Total registered users
    const { count: totalUsers } = await supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true })

    // Active users in last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const [{ data: practiceSessions }, { data: assessmentResults }] = await Promise.all([
      supabaseAdmin
        .from('practice_sessions')
        .select('auth_user_id')
        .gte('session_date', oneDayAgo),
      supabaseAdmin
        .from('assessment_results')
        .select('auth_user_id')
        .gte('attempt_date', oneDayAgo),
    ])

    const activeUserIds = new Set([
      ...(practiceSessions?.map((r) => r.auth_user_id) ?? []),
      ...(assessmentResults?.map((r) => r.auth_user_id) ?? []),
    ])

    // Levels completed today (passed assessments)
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const { count: levelsCompletedToday } = await supabaseAdmin
      .from('assessment_results')
      .select('*', { count: 'exact', head: true })
      .eq('is_passed', true)
      .gte('attempt_date', todayStart.toISOString())

    return NextResponse.json({
      totalUsers: totalUsers ?? 0,
      activeUsersToday: activeUserIds.size,
      levelsCompletedToday: levelsCompletedToday ?? 0,
    })
  } catch (error) {
    console.error('[admin/stats]', error)
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}
