import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'
// V-6: single source of truth (role + disabled/archived enforcement lives there).
import { getAuthorizedAdmin } from '@/lib/adminAuth'

export async function GET(request: NextRequest) {
  const user = await getAuthorizedAdmin(request)
  if (!user) {
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
    logger.error('admin/stats', 'get_failed', { reason: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}
