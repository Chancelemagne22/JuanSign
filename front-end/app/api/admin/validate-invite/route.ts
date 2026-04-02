import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')

    if (!code) {
      return NextResponse.json(
        { error: 'Code parameter is required' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('admin_invites')
      .select('id, code, is_used, expires_at')
      .eq('code', code)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { valid: false, error: 'Invite code not found' },
          { status: 404 }
        )
      }
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    if (data.is_used) {
      return NextResponse.json(
        { valid: false, error: 'Invite code has already been used' },
        { status: 410 }
      )
    }

    const expiresAt = new Date(data.expires_at)
    if (expiresAt < new Date()) {
      return NextResponse.json(
        { valid: false, error: 'Invite code has expired' },
        { status: 410 }
      )
    }

    return NextResponse.json({
      valid: true,
      code: data.code,
      expiresAt: data.expires_at,
    })
  } catch (error) {
    console.error('Error validating invite:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}