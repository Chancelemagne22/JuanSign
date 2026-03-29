import PresenceHeartbeat from '@/components/PresenceHeartbeat'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PresenceHeartbeat />
      {children}
    </>
  )
}
