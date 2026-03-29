import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Uses service role — runs server-side only, never exposed to client.
// Handles avatar upload + profile update when no session exists yet
// (i.e. email confirmation is required and user hasn't confirmed yet).

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const userId    = formData.get('userId')    as string
  const username  = formData.get('username')  as string
  const firstName = formData.get('firstName') as string
  const lastName  = formData.get('lastName')  as string
  const photo     = formData.get('photo')     as File | null

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let avatarUrl: string | null = null

  if (photo && photo.size > 0) {
    const ext      = photo.name.split('.').pop() ?? 'jpg'
    const filePath = `${userId}.${ext}`
    const buffer   = await photo.arrayBuffer()

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, buffer, { contentType: photo.type, upsert: true })

    if (!uploadError) {
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath)
      avatarUrl = urlData.publicUrl
    }
  }

  await supabase
    .from('profiles')
    .update({
      username,
      first_name: firstName,
      last_name:  lastName,
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    })
    .eq('auth_user_id', userId)

  return NextResponse.json({ avatarUrl })
}
