import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

/**
 * Verifies admin authorization by:
 * 1. Extracting Bearer token from Authorization header
 * 2. Validating token with Supabase auth
 * 3. Checking that user has 'admin' or 'super_admin' role in profiles table
 * 4. (V-8) Denying disabled/archived accounts (is_active=false or is_archived=true)
 *
 * Single source of truth for admin API auth — all /api/admin/* routes must use
 * this instead of local copies. Returns the authorized user or null if unauthorized.
 */
export async function getAuthorizedAdmin(request: NextRequest) {
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
    .select('role, is_active, is_archived')
    .eq('auth_user_id', userId)
    .single()

  if (profileError || !profile || !['admin', 'super_admin'].includes(profile.role)) {
    return null
  }

  // V-8: disabled/archived admins lose API access on their next request.
  if (profile.is_active === false || profile.is_archived === true) {
    return null
  }

  return user
}
