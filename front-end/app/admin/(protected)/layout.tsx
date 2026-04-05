import AdminSidebar from '@/components/admin/AdminSidebar'

const ADMIN_NAME = process.env.ADMIN_NAME ?? 'Admin'
const ADMIN_AVATAR_URL = process.env.ADMIN_AVATAR_URL ?? ''

export default function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
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
            Hello, {ADMIN_NAME}!
          </h1>

          <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-white flex-shrink-0">
            {ADMIN_AVATAR_URL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ADMIN_AVATAR_URL} alt="Admin avatar" className="w-full h-full object-cover" />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center text-white font-bold text-lg"
                style={{ backgroundColor: '#B5621E', fontFamily: 'var(--font-fredoka)' }}
              >
                {ADMIN_NAME[0]?.toUpperCase()}
              </div>
            )}
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
