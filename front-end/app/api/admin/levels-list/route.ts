import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getAuthorizedAdmin } from '@/lib/adminAuth'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const adminUser = await getAuthorizedAdmin(request)
  if (!adminUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { data: levels, error } = await supabaseAdmin
      .from('levels')
      .select('level_id, level_name, sequence_order, level_order, category')
      .order('sequence_order', { ascending: true })

    if (error) throw error

    return NextResponse.json({ levels: levels ?? [] })
  } catch (err) {
    logger.error('admin/levels-list', 'get_failed', { reason: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Failed to fetch levels' }, { status: 500 })
  }
}
