import PresenceHeartbeat from '@/components/PresenceHeartbeat'
import AuthGuard from '@/components/AuthGuard'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <PresenceHeartbeat />
      {children}
    </AuthGuard>
  )
}
