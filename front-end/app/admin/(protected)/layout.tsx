'use client'

import { useState, useEffect } from 'react'
import AdminSidebar from '@/components/admin/AdminSidebar'
import { supabase } from '@/lib/supabase'

export default function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  const [adminName, setAdminName] = useState('Admin')
  const [loading, setLoading] = useState(true)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

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
    <div className="relative flex min-h-screen" style={{ backgroundColor: '#FFF8DC' }}>
      <AdminSidebar mobileOpen={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Top bar */}
        <header
          className="flex items-center justify-between px-4 sm:px-6 lg:px-8 py-3 lg:py-4 shrink-0 relative z-20"
          style={{ backgroundColor: '#7B9A2E' }}
        >
          <button
            type="button"
            className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-full text-white border border-white/30 shrink-0"
            style={{ backgroundColor: '#B5621E' }}
            onClick={() => setMobileSidebarOpen((prev) => !prev)}
            aria-label={mobileSidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            aria-expanded={mobileSidebarOpen}
          >
            <span className="flex flex-col gap-1">
              <span className="block w-4 h-0.5 bg-white rounded" />
              <span className="block w-4 h-0.5 bg-white rounded" />
              <span className="block w-4 h-0.5 bg-white rounded" />
            </span>
          </button>

          <h1
            className="text-white text-lg sm:text-2xl font-bold truncate px-3 lg:px-4 flex-1"
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
        <main className="flex-1 min-h-0 px-4 sm:px-5 lg:px-6 pb-4 sm:pb-5 lg:pb-6 pt-0">
          <div className="min-h-0">{children}</div>
        </main>
      </div>
    </div>
  )
}
