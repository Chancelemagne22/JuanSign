import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

async function isSuperAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('auth_user_id', userId)
    .single()

  if (error || !data) {
    return false
  }

  return data.role === 'super_admin'
}

export async function POST(request: NextRequest) {
  try {
    const { inviteCode, userId, action } = await request.json()

    // Handle approval/rejection actions
    if (action && ['approve', 'reject'].includes(action)) {
      const authHeader = request.headers.get('authorization')
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return NextResponse.json(
          { error: 'Missing authorization header' },
          { status: 401 }
        )
      }

      const token = authHeader.substring(7)
      const { data: user, error: authError } = await supabaseAdmin.auth.getUser(token)

      if (authError || !user) {
        return NextResponse.json(
          { error: 'Invalid or expired token' },
          { status: 401 }
        )
      }

      const isSuperAdminUser = await isSuperAdmin(user.user.id)
      if (!isSuperAdminUser) {
        return NextResponse.json(
          { error: 'Only super_admin can approve invites' },
          { status: 403 }
        )
      }

      if (action === 'approve') {
        const { data, error } = await supabaseAdmin.rpc('approve_admin_invite', {
          invite_code: inviteCode,
          approver_user_id: user.user.id,
        })

        if (error) {
          console.error('RPC Error:', error)
          return NextResponse.json(
            { error: error.message || 'Failed to approve invite' },
            { status: 500 }
          )
        }

        if (!data?.success) {
          return NextResponse.json(
            { error: data?.error || 'Failed to approve invite' },
            { status: 400 }
          )
        }

        return NextResponse.json({
          success: true,
          message: data.message,
        })
      } else {
        // Reject
        const { data: invite, error: fetchError } = await supabaseAdmin
          .from('admin_invites')
          .select('id, status')
          .eq('code', inviteCode)
          .single()

        if (fetchError) {
          return NextResponse.json(
            { error: 'Invite code not found' },
            { status: 404 }
          )
        }

        if (invite.status === 'rejected') {
          return NextResponse.json(
            { error: 'Invite has already been rejected' },
            { status: 400 }
          )
        }

        const { error: updateError } = await supabaseAdmin
          .from('admin_invites')
          .update({
            status: 'rejected',
            approved_by: user.user.id,
            approved_at: new Date().toISOString(),
          })
          .eq('code', inviteCode)

        if (updateError) {
          return NextResponse.json(
            { error: 'Failed to reject invite' },
            { status: 500 }
          )
        }

        return NextResponse.json({
          success: true,
          message: 'Invite rejected successfully',
        })
      }
    }

    // Original signup completion logic
    if (!inviteCode || !userId) {
      return NextResponse.json(
        { error: 'Missing inviteCode or userId' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin.rpc('handle_admin_signup', {
      invite_code: inviteCode,
      user_id: userId,
    })

    if (error) {
      console.error('RPC Error:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    if (!data?.success) {
      return NextResponse.json(
        { error: data?.error || 'Failed to complete admin setup' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      message: data.message,
    })
  } catch (error) {
    console.error('Error in setup-admin:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// GET endpoint to fetch pending invites
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing authorization header' },
        { status: 401 }
      )
    }

    const token = authHeader.substring(7)
    const { data: user, error: authError } = await supabaseAdmin.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    const isSuperAdminUser = await isSuperAdmin(user.user.id)
    if (!isSuperAdminUser) {
      return NextResponse.json(
        { error: 'Only super_admin can view pending invites' },
        { status: 403 }
      )
    }

    // Get pending invites that have been used but not yet approved
    const { data: pendingInvites, error } = await supabaseAdmin
      .from('admin_invites')
      .select('id, code, email, created_at, used_by_user_id, status, used_at')
      .eq('status', 'pending')
      .eq('is_used', true)
      .order('used_at', { ascending: false })

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch pending invites' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      pendingInvites: pendingInvites || [],
    })
  } catch (error) {
    console.error('Error fetching pending invites:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
