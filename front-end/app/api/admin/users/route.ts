import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
// V-6: single source of truth (role + disabled/archived enforcement lives there).
import { getAuthorizedAdmin } from '@/lib/adminAuth'
import { logger } from '@/lib/logger'

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
  const user = await getAuthorizedAdmin(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // I-1: fetch tables in parallel. Auth emails are paged (100/page) with
    // early-stop once every listed student id is resolved — no more silent
    // truncation at 1000 users, and no 1000-row dump per request.
    const [
      { data: profiles },
      { data: progressRows },
      { data: levels },
      { data: practiceSessions },
      { data: assessmentResults },
    ] = await Promise.all([
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

    const neededIds = new Set((profiles ?? []).map((p) => p.auth_user_id))
    const emailById = new Map<string, string>()
    // listUsers pages are newest-first; walk pages until all ids resolve.
    for (let page = 1; page <= 50 && emailById.size < neededIds.size; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 })
      if (error || !data?.users?.length) break
      for (const u of data.users) {
        if (neededIds.has(u.id) && !emailById.has(u.id)) {
          emailById.set(u.id, u.email ?? 'N/A')
        }
      }
      if (data.users.length < 100) break
    }

    // I-1: linear joins via Maps (was O(N^2) .find/.filter per profile).
    // Rows arrive pre-ordered desc by date, so index 0 == latest.
    const groupByUser = <T extends { auth_user_id: string }>(rows: T[] | null) => {
      const m = new Map<string, T[]>()
      for (const r of rows ?? []) {
        const arr = m.get(r.auth_user_id)
        if (arr) arr.push(r)
        else m.set(r.auth_user_id, [r])
      }
      return m
    }
    const sessionsByUser = groupByUser(practiceSessions)
    const resultsByUser = groupByUser(assessmentResults)
    const progressByUser = groupByUser(progressRows)
    const levelsById = new Map((levels ?? []).map((l) => [l.level_id, l.level_name]))

    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000)

    const users: AdminUser[] = (profiles ?? []).map((profile, index) => {
      // Last activity timestamp (for display only)
      const lastPractice = sessionsByUser.get(profile.auth_user_id)?.[0]
      const lastAssessment = resultsByUser.get(profile.auth_user_id)?.[0]
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
      const userProgress = (progressByUser.get(profile.auth_user_id) ?? []).filter(
        (p) => p.is_unlocked
      )
      const fallbackLevelId =
        userProgress.length > 0 ? userProgress[userProgress.length - 1].level_id : null
      const currentLevelId = recentLevelId ?? fallbackLevelId
      const currentLevel = (currentLevelId ? levelsById.get(currentLevelId) : undefined) ?? 'N/A'

      // Progress % — best_score on current level from user_progress, else avg accuracy
      const currentProgress = (progressByUser.get(profile.auth_user_id) ?? []).find(
        (p) => p.level_id === currentLevelId
      )
      const userSessions = sessionsByUser.get(profile.auth_user_id) ?? []
      const avgAccuracy =
        userSessions.length > 0
          ? Math.round(
              userSessions.reduce((sum, s) => sum + (s.average_accuracy ?? 0), 0) /
                userSessions.length
            )
          : 0
      const progress = currentProgress?.best_score ?? avgAccuracy

      // Levels completed — highest level passed
      const passedLevels = (resultsByUser.get(profile.auth_user_id) ?? []).filter(
        (r) => r.is_passed
      )
      const passedLevelNames = passedLevels.map(
        (r) => levelsById.get(r.level_id) ?? 'N/A'
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
        email: emailById.get(profile.auth_user_id) ?? 'N/A',
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
    logger.error('admin/users', 'fetch_failed', { reason: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}
export async function DELETE(request: NextRequest) {
  // 1. Check Authorization (V-6 fix: was missing `await` — Promise is always
  // truthy, so archiving was effectively unauthenticated).
  if (!(await getAuthorizedAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Get User ID
  const authUserId = new URL(request.url).searchParams.get('authUserId')
  if (!authUserId) {
    return NextResponse.json({ error: 'authUserId is required' }, { status: 400 })
  }

  try {
  
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ 
        is_archived: true, 
        archived_at: new Date().toISOString() 
      })
      .eq('auth_user_id', authUserId)

    if (error) throw error
    return NextResponse.json({ 
        success: true, 
        message: 'User account has been archived and data preserved.' 
    })

  } catch (error) {
    logger.error('admin/users', 'archive_failed', { reason: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to archive user' }, { status: 500 })
  }
}
export async function PATCH(request: NextRequest) {
  // V-6 fix: restore endpoint had NO auth check at all.
  if (!(await getAuthorizedAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { authUserId } = await request.json();

  try {
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ 
        is_archived: false, 
        archived_at: null 
      })
      .eq('auth_user_id', authUserId)

    if (error) throw error
    return NextResponse.json({ success: true, message: 'Account restored!' })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to restore' }, { status: 500 })
  }
}