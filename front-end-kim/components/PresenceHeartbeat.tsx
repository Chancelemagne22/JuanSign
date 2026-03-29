'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

// Pings last_seen every 60 seconds while the user has the app open.
// Mount this in any layout that wraps authenticated pages.
export default function PresenceHeartbeat() {
  useEffect(() => {

    const ping = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase
        .from('profiles')
        .update({ last_seen: new Date().toISOString() })
        .eq('auth_user_id', user.id)
    }

    ping() // ping immediately on mount
    const interval = setInterval(ping, 180_000) // then every 60 seconds

    return () => clearInterval(interval)
  }, [])

  return null
}
