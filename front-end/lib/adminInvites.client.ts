// Client-safe invite functions (no server-side imports)

/**
 * Build the full invite signup URL
 */
export function buildInviteUrl(code: string, baseUrl?: string): string {
  const url = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '')
  return `${url}/admin/setup?code=${encodeURIComponent(code)}`
}

/**
 * Approve a pending admin invite (super-admin only)
 */
export async function approveAdminInvite(token: string, inviteCode: string) {
  const response = await fetch('/api/admin/setup-admin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      inviteCode,
      action: 'approve',
    }),
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || 'Failed to approve invite')
  }

  return data
}

/**
 * Reject a pending admin invite (super-admin only)
 */
export async function rejectAdminInvite(token: string, inviteCode: string) {
  const response = await fetch('/api/admin/setup-admin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      inviteCode,
      action: 'reject',
    }),
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || 'Failed to reject invite')
  }

  return data
}

/**
 * Get pending admin invites that need approval (super-admin only)
 */
export async function getPendingInvites(token: string) {
  const response = await fetch('/api/admin/setup-admin', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch pending invites')
  }

  return data.pendingInvites || []
}
