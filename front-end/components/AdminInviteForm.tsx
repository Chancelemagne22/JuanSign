'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { buildInviteUrl } from '@/lib/adminInvites.client'

export default function AdminInviteForm() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [generatedCode, setGeneratedCode] = useState('')
  const [inviteUrl, setInviteUrl] = useState('')

  const handleGenerateInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('No active session')
      }

      const response = await fetch('/api/admin/generate-invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate invite')
      }

      setGeneratedCode(data.code)
      setInviteUrl(buildInviteUrl(data.code))
      setSuccess(`Invite code generated: ${data.code}`)

      // Auto-copy to clipboard
      navigator.clipboard.writeText(buildInviteUrl(data.code))
      setSuccess(`Invite link copied to clipboard! Code: ${data.code}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate invite')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-4xl mx-auto p-6">
      {/* Error / Success Messages */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 text-green-700 rounded">
          {success}
        </div>
      )}

      {/* Generate Invite Form */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-4">Generate New Admin Invite</h2>

        <form onSubmit={handleGenerateInvite} className="space-y-4">
          <p className="text-gray-600 text-sm">
            Generate a unique invite code for a new admin. The invited user will complete
            their signup and immediately get admin access.
          </p>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-400 text-white font-semibold py-3 px-4 rounded transition"
          >
            {loading ? 'Generating...' : 'Generate Invite Code'}
          </button>
        </form>

        {generatedCode && (
          <div className="mt-6 p-4 bg-yellow-50 rounded border border-yellow-200">
            <p className="text-sm font-semibold text-gray-700 mb-2">Invite Code:</p>
            <p className="text-2xl font-mono font-bold text-yellow-600 mb-4">{generatedCode}</p>

            <p className="text-sm font-semibold text-gray-700 mb-2">Full Invite Link:</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={inviteUrl}
                readOnly
                className="flex-1 px-3 py-2 border border-gray-300 rounded bg-white font-mono text-sm"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(inviteUrl)
                  alert('Link copied to clipboard!')
                }}
                className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700"
              >
                Copy
              </button>
            </div>

            <p className="text-xs text-gray-600 mt-3">
              Share this link or code with the new admin. They have 24 hours to sign up.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
