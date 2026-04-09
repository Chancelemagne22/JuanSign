'use client'

import { Suspense } from 'react'
import AdminSetupContent from '@/components/admin/AdminSetupContent'

export default function AdminSetupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gradient-to-br from-yellow-50 to-yellow-100 flex items-center justify-center"><p className="text-gray-600">Loading...</p></div>}>
      <AdminSetupContent />
    </Suspense>
  )
}
