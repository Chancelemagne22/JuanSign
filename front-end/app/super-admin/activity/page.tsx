'use client'

import AdminInviteForm from '@/components/AdminInviteForm'

export default function SuperAdminActivityPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <h1 className="text-4xl font-bold text-gray-900 mb-8">Super Admin Dashboard</h1>
      <AdminInviteForm />
    </div>
  )
}
