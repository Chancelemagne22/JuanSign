import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

function isAuthorized(request: NextRequest): boolean {
  const cookie = request.cookies.get('admin_auth')?.value
  const secret = process.env.ADMIN_AUTH_SECRET
  return !!(cookie && secret && cookie === secret)
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { data: levels, error } = await supabaseAdmin
      .from('levels')
      .select('level_id, level_name')
      .order('level_name', { ascending: true })

    if (error) throw error

    return NextResponse.json({ levels: levels ?? [] })
  } catch (err) {
    console.error('[admin/levels-list]', err)
    return NextResponse.json({ error: 'Failed to fetch levels' }, { status: 500 })
  }
}
