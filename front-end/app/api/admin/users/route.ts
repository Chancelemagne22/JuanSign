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

export interface AdminUser {
  displayId: string
  authUserId: string
  fullName: string
  email: string
  currentLevel: string
  currentLevelId: string | null
  progress: number
  status: 'Active' | 'Inactive' | 'Disabled'
  lastActive: string | null
  avgAccuracy: number
  levelsCompleted: string
  avatarUrl: string | null
  role: string
}

export async function GET(request: NextRequest) {
  const user = await getAuthorizedUser(request)
  console.log("Is this shii?")
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Fetch everything in parallel
    const [
      { data: { users: authUsers } },
      { data: profiles },
      { data: progressRows },
      { data: levels },
      { data: practiceSessions },
      { data: assessmentResults },
    ] = await Promise.all([
      supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }),
      supabaseAdmin
        .from('profiles')
        .select('auth_user_id, username, first_name, last_name, avatar_url, is_active, last_seen, role')
        .eq('role', 'student')
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('user_progress')
        .select('auth_user_id, level_id, best_score, lessons_completed, is_unlocked'),
      supabaseAdmin.from('levels').select('level_id, level_name'),
      supabaseAdmin
        .from('practice_sessions')
        .select('auth_user_id, average_accuracy, session_date, level_id')
        .order('session_date', { ascending: false }),
      supabaseAdmin
        .from('assessment_results')
        .select('auth_user_id, level_id, attempt_date, is_passed')
        .order('attempt_date', { ascending: false }),
    ])

    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000)

    const users: AdminUser[] = (profiles ?? []).map((profile, index) => {
      const authUser = authUsers?.find((u) => u.id === profile.auth_user_id)

      // Last activity timestamp (for display only)
      const lastPractice = practiceSessions?.find(
        (s) => s.auth_user_id === profile.auth_user_id
      )
      const lastAssessment = assessmentResults?.find(
        (r) => r.auth_user_id === profile.auth_user_id
      )
      const timestamps = [lastPractice?.session_date, lastAssessment?.attempt_date].filter(Boolean)
      const lastActive = timestamps.length
        ? timestamps.sort().reverse()[0]
        : null

      // Status: Active = last_seen within 2 minutes (currently using the app)
      let status: 'Active' | 'Inactive' | 'Disabled' = 'Inactive'
      if (profile.is_active === false) {
        status = 'Disabled'
      } else if (profile.last_seen && new Date(profile.last_seen) > twoMinutesAgo) {
        status = 'Active'
      }

      // Current level — from most recent activity
      const recentLevelId =
        lastPractice?.level_id ?? lastAssessment?.level_id ?? null

      // If no recent activity, fall back to the latest unlocked level from user_progress
      const userProgress = (progressRows ?? []).filter(
        (p) => p.auth_user_id === profile.auth_user_id && p.is_unlocked
      )
      const fallbackLevelId =
        userProgress.length > 0 ? userProgress[userProgress.length - 1].level_id : null
      const currentLevelId = recentLevelId ?? fallbackLevelId
      const currentLevel = (levels ?? []).find((l) => l.level_id === currentLevelId)?.level_name ?? 'N/A'

      // Progress % — best_score on current level from user_progress, else avg accuracy
      const currentProgress = (progressRows ?? []).find(
        (p) => p.auth_user_id === profile.auth_user_id && p.level_id === currentLevelId
      )
      const userSessions = (practiceSessions ?? []).filter(
        (s) => s.auth_user_id === profile.auth_user_id
      )
      const avgAccuracy =
        userSessions.length > 0
          ? Math.round(
              userSessions.reduce((sum, s) => sum + (s.average_accuracy ?? 0), 0) /
                userSessions.length
            )
          : 0
      const progress = currentProgress?.best_score ?? avgAccuracy

      // Levels completed — highest level passed
      const passedLevels = (assessmentResults ?? []).filter(
        (r) => r.auth_user_id === profile.auth_user_id && r.is_passed
      )
      const passedLevelNames = passedLevels.map(
        (r) => (levels ?? []).find((l) => l.level_id === r.level_id)?.level_name ?? 'N/A'
      )
      const levelsCompleted =
        passedLevelNames.length > 0 ? passedLevelNames[passedLevelNames.length - 1] : 'None'

      const fullName =
        `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() ||
        profile.username ||
        'Unknown'

      return {
        displayId: String(1000 + index + 1).padStart(4, '0'),
        authUserId: profile.auth_user_id,
        fullName,
        email: authUser?.email ?? 'N/A',
        currentLevel,
        currentLevelId,
        progress: Math.min(100, Math.max(0, progress ?? 0)),
        status,
        lastActive,
        avgAccuracy,
        levelsCompleted,
        avatarUrl: profile.avatar_url ?? null,
        role: profile.role,
      }
    })

    return NextResponse.json({ users })
  } catch (error) {
    console.error('[admin/users]', error)
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  if (!getAuthorizedUser(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const authUserId = new URL(request.url).searchParams.get('authUserId')
  if (!authUserId) {
    return NextResponse.json({ error: 'authUserId is required' }, { status: 400 })
  }

  try {
    // Delete user profile
    await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('auth_user_id', authUserId)

    // Delete user progress
    await supabaseAdmin
      .from('user_progress')
      .delete()
      .eq('auth_user_id', authUserId)

    // Delete practice sessions
    await supabaseAdmin
      .from('practice_sessions')
      .delete()
      .eq('auth_user_id', authUserId)

    // Delete assessment results
    await supabaseAdmin
      .from('assessment_results')
      .delete()
      .eq('auth_user_id', authUserId)

    // Delete from Supabase Auth
    await supabaseAdmin.auth.admin.deleteUser(authUserId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[admin/users DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }
}
