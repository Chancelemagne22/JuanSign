'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/admin' },
  { label: 'User Accounts', href: '/admin/users' },
  { label: 'Edit Level', href: '/admin/levels' },
  { label: 'Performance Report', href: '/admin/reports' },
  { label: 'System Settings', href: '/admin/settings' },
]

export default function AdminSidebar() {
  const pathname = usePathname()
  const router = useRouter()

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' })
    router.push('/admin/login')
  }

  return (
    <aside
      className="w-[220px] lg:w-[270px] h-auto lg:h-full min-h-0 flex flex-col flex-shrink-0"
      style={{ backgroundColor: '#FFF8DC' }}
    >
      {/* Logo */}
      <div className="px-4 lg:px-6 pt-5 lg:pt-6 pb-3 lg:pb-4 shrink-0">
        <div className="flex items-center gap-1">
          <span
            style={{
              fontFamily: 'var(--font-spicy-rice)',
              fontSize: '1.35rem',
              color: '#F4A261',
              textShadow:
                '2px 2px 0 #7B3F00, -1px -1px 0 #7B3F00, 1px -1px 0 #7B3F00, -1px 1px 0 #7B3F00',
            }}
          >
            JuanSign
          </span>
          <span
            style={{
              fontFamily: 'var(--font-fredoka)',
              fontSize: '1.1rem',
              fontWeight: 700,
              color: '#5D3A1A',
            }}
          >
            ADMIN
          </span>
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex flex-col gap-1 px-3 lg:px-4 flex-1 min-h-0 overflow-y-auto mt-1 lg:mt-2">
        {NAV_ITEMS.map((item) => (
          <Link key={item.href} href={item.href}>
            <div
              className="w-full px-5 py-3 rounded-xl text-center font-bold transition-all"
              style={{
                fontFamily: 'var(--font-fredoka)',
                fontSize: '0.95rem',
                backgroundColor: isActive(item.href) ? '#B5621E' : 'transparent',
                color: isActive(item.href) ? '#FFFFFF' : '#5D3A1A',
              }}
              onMouseEnter={(e) => {
                if (!isActive(item.href))
                  (e.currentTarget as HTMLDivElement).style.backgroundColor = '#F4E0B0'
              }}
              onMouseLeave={(e) => {
                if (!isActive(item.href))
                  (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'
              }}
            >
              {item.label}
            </div>
          </Link>
        ))}
      </nav>

      {/* Logout */}
      <div className="px-3 lg:px-4 pb-4 lg:pb-8 pt-2 shrink-0">
        <button
          onClick={handleLogout}
          className="w-full px-5 py-3 rounded-xl text-center font-bold transition-all"
          style={{
            fontFamily: 'var(--font-fredoka)',
            fontSize: '0.95rem',
            color: '#FFFFFF',
            backgroundColor: '#DC2626',
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#B91C1C')
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#DC2626')
          }
        >
          Logout
        </button>
      </div>
    </aside>
  )
}
