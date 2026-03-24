import { createClient } from 'jsr:@supabase/supabase-js@2'

// Runs every 30 minutes via Deno cron.
// Deletes avatar photos of users who signed up but never confirmed their email.

Deno.cron('cleanup-unconfirmed-avatars', '*/30 * * * *', async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()

  // Get profiles created more than 30 minutes ago that have an avatar
  const { data: profiles } = await supabase
    .from('profiles')
    .select('auth_user_id, avatar_url')
    .not('avatar_url', 'is', null)
    .lt('created_at', cutoff)

  if (!profiles?.length) return

  for (const profile of profiles) {
    // Check if the auth user has confirmed their email
    const { data: { user } } = await supabase.auth.admin.getUserById(profile.auth_user_id)

    if (!user || user.email_confirmed_at) continue  // confirmed or not found — skip

    // Extract storage path from public URL  e.g. ".../avatars/uuid.jpg" → "uuid.jpg"
    const path = profile.avatar_url.split('/avatars/')[1]
    if (!path) continue

    await supabase.storage.from('avatars').remove([path])
    await supabase
      .from('profiles')
      .update({ avatar_url: null })
      .eq('auth_user_id', profile.auth_user_id)

    console.log(`Cleaned avatar for unconfirmed user: ${profile.auth_user_id}`)
  }
})
