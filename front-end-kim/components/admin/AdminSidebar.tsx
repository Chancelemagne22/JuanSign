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
      className="w-[270px] min-h-screen flex flex-col flex-shrink-0"
      style={{ backgroundColor: '#FFF8DC' }}
    >
      {/* Logo */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center gap-1">
          <span
            style={{
              fontFamily: 'var(--font-spicy-rice)',
              fontSize: '1.6rem',
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
              fontSize: '1.25rem',
              fontWeight: 700,
              color: '#5D3A1A',
            }}
          >
            ADMIN
          </span>
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex flex-col gap-1 px-4 flex-1 mt-2">
        {NAV_ITEMS.map((item) => (
          <Link key={item.href} href={item.href}>
            <div
              className="w-full px-5 py-3 rounded-xl text-center font-bold transition-all"
              style={{
                fontFamily: 'var(--font-fredoka)',
                fontSize: '1.05rem',
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
      <div className="px-4 pb-8">
        <button
          onClick={handleLogout}
          className="w-full px-5 py-3 rounded-xl text-center font-bold transition-all"
          style={{ fontFamily: 'var(--font-fredoka)', fontSize: '1.05rem', color: '#5D3A1A' }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F4E0B0')
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')
          }
        >
          Logout
        </button>
      </div>
    </aside>
  )
}
