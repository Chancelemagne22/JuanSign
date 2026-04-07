'use client'

import { useState, useEffect } from 'react'
import AdminSidebar from '@/components/admin/AdminSidebar'
import { supabase } from '@/lib/supabase'

export default function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  const [adminName, setAdminName] = useState('Admin')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchAdminInfo = async () => {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser()

        if (!user || userError) {
          setAdminName('Admin')
          setLoading(false)
          return
        }

        // Fetch admin details from profiles table
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('first_name, last_name, username')
          .eq('auth_user_id', user.id)
          .single()

        if (profileError) {
          console.error('Profile fetch error:', profileError)
          setAdminName('Admin')
        } else if (!profile) {
          console.warn('No profile found for user:', user.id)
          setAdminName('Admin')
        } else {
          // Use first_name/last_name if available, otherwise use username
          const fullName = [profile.first_name, profile.last_name]
            .filter(Boolean)
            .join(' ')
            .trim()
          setAdminName(fullName || profile.username || 'Admin')
        }
      } catch (error) {
        console.error('Error fetching admin info:', error)
        setAdminName('Admin')
      } finally {
        setLoading(false)
      }
    }

    fetchAdminInfo()
  }, [])

  return (
    <div className="flex min-h-dvh lg:h-dvh" style={{ backgroundColor: '#FFF8DC' }}>
      <AdminSidebar />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Top bar */}
        <header
          className="flex items-center justify-between px-4 sm:px-6 lg:px-8 py-3 lg:py-4 shrink-0"
          style={{ backgroundColor: '#7B9A2E' }}
        >
          <h1
            className="text-white text-xl sm:text-2xl font-bold truncate pr-4"
            style={{ fontFamily: 'var(--font-fredoka)' }}
          >
            Hello, {loading ? 'Admin' : adminName}!
          </h1>

          <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-white shrink-0">
            <div
              className="w-full h-full flex items-center justify-center text-white font-bold text-lg"
              style={{ backgroundColor: '#B5621E', fontFamily: 'var(--font-fredoka)' }}
            >
              {(adminName || 'A')[0]?.toUpperCase()}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 min-h-0 px-4 sm:px-5 lg:px-6 pb-4 sm:pb-5 lg:pb-6 pt-0 overflow-y-auto lg:overflow-hidden">
          <div className="h-full min-h-0">{children}</div>
        </main>
      </div>
    </div>
  )
}
