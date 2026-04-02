import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { generateInviteCode } from '@/lib/adminInvites'

// Helper function to check if user is super_admin
async function isSuperAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()

  if (error || !data) {
    return false
  }

  return data.role === 'super_admin'
}

export async function POST(request: NextRequest) {
  try {
    // Get the authorization header
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing authorization header' },
        { status: 401 }
      )
    }

    const token = authHeader.substring(7)

    // Verify the token with Supabase
    const { data: user, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    // Check if user is super_admin
    const isSuperAdminUser = await isSuperAdmin(user.user.id)
    if (!isSuperAdminUser) {
      return NextResponse.json(
        { error: 'Only super admins can generate invite codes' },
        { status: 403 }
      )
    }

    // Generate invite code
    const code = generateInviteCode()
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + 24) // 24-hour expiry

    // Insert into admin_invites table
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
      console.error('Error creating invite:', error)
      return NextResponse.json(
        { error: 'Failed to create invite code' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      code: data.code,
      expiresAt: data.expires_at,
    })
  } catch (error) {
    console.error('Error in generate-invite:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
