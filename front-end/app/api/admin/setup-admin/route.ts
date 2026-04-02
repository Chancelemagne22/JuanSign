import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  try {
    const { inviteCode, userId } = await request.json()

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