import { supabase } from './supabase'
import { supabaseAdmin } from './supabase-server'

/**
 * Generate a random alphanumeric invite code
 * Format: 8 characters (A-Z, 0-9)
 */
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

/**
 * Create an admin invite (server-side only)
 */
export async function createAdminInvite(expiryHours: number = 24) {
  const code = generateInviteCode()
  const expiresAt = new Date()
  expiresAt.setHours(expiresAt.getHours() + expiryHours)

  const { data, error } = await supabaseAdmin
    .from('admin_invites')
    .insert({
      code,
      is_used: false,
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create invite: ${error.message}`)
  }

  return data
}

/**
 * Validate an invite code (client-safe)
 * Returns the code details if valid and unused
 */
export async function validateInviteCode(code: string) {
  const { data, error } = await supabase
    .from('admin_invites')
    .select('id, code, is_used, expires_at')
    .eq('code', code)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return { valid: false, error: 'Invite code not found' }
    }
    return { valid: false, error: error.message }
  }

  // Check if already used
  if (data.is_used) {
    return { valid: false, error: 'Invite code has already been used' }
  }

  // Check if expired
  const expiresAt = new Date(data.expires_at)
  if (expiresAt < new Date()) {
    return { valid: false, error: 'Invite code has expired' }
  }

  return { valid: true, data }
}

/**
 * Call the RPC function to complete admin signup
 * This should be called AFTER the user has signed up in Supabase Auth
 */
export async function completeAdminSignup(inviteCode: string, userId: string) {
  const { data, error } = await supabase.rpc('handle_admin_signup', {
    invite_code: inviteCode,
    user_id: userId,
  })

  if (error) {
    throw new Error(`Failed to complete admin signup: ${error.message}`)
  }

  // Check the RPC response
  if (!data?.success) {
    throw new Error(data?.error || 'Unknown error during admin signup')
  }

  return data
}

/**
 * Get all active invite codes (super-admin only)
 */
export async function getActiveInvites() {
  const { data, error } = await supabase
    .from('admin_invites')
    .select('id, code, is_used, created_at, expires_at')
    .eq('is_used', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch invites: ${error.message}`)
  }

  return data
}

/**
 * Get invite history (super-admin only)
 */
export async function getInviteHistory(limit: number = 50) {
  const { data, error } = await supabase
    .from('admin_invites')
    .select('id, code, is_used, created_at, expires_at, used_by_user_id, used_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to fetch invite history: ${error.message}`)
  }

  return data
}

/**
 * Build the full invite signup URL
 */
export function buildInviteUrl(code: string, baseUrl?: string): string {
  const url = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '')
  return `${url}/admin/setup?code=${encodeURIComponent(code)}`
}
