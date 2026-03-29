import AdminSidebar from '@/components/admin/AdminSidebar'

const ADMIN_NAME = process.env.ADMIN_NAME ?? 'Admin'
const ADMIN_AVATAR_URL = process.env.ADMIN_AVATAR_URL ?? ''

export default function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen" style={{ backgroundColor: '#FFF8DC' }}>
      <AdminSidebar />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header
          className="flex items-center justify-between px-8 py-4"
          style={{ backgroundColor: '#7B9A2E' }}
        >
          <h1
            className="text-white text-2xl font-bold"
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
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
