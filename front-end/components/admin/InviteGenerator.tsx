'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { buildInviteUrl } from '@/lib/adminInvites'

export default function InviteGenerator() {
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [error, setError] = useState('')

  const generateInvite = async () => {
    setLoading(true)
    setError('')

    try {
      const { data: authData } = await supabase.auth.getUser()
      if (!authData.user?.session?.access_token) {
        throw new Error('Not authenticated')
      }

      const response = await fetch('/api/admin/generate-invite', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authData.user.session.access_token}`,
          'Content-Type': 'application/json',
        },
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate invite')
      }

      setInviteCode(data.code)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate invite')
      setInviteCode(null)
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = () => {
    if (!inviteCode) return

    const url = buildInviteUrl(inviteCode)
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 border border-yellow-100">
      <h2 className="text-xl font-bold mb-4" style={{ color: '#5D3A1A' }}>
        Generate Admin Invite
      </h2>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded mb-4 text-sm">
          {error}
        </div>
      )}

      {inviteCode ? (
        <div className="space-y-3">
          <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
            <p className="text-xs text-gray-600 mb-1">Invite Code:</p>
            <p className="font-mono font-bold text-lg">{inviteCode}</p>
            <p className="text-xs text-gray-500 mt-1">Valid for 24 hours</p>
          </div>

          <button
            onClick={copyToClipboard}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-3 rounded transition text-sm"
          >
            {copied ? '✓ Copied to Clipboard' : 'Copy Invite Link'}
          </button>

          <button
            onClick={() => {
              setInviteCode(null)
              generateInvite()
            }}
            className="w-full bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-3 rounded transition text-sm"
          >
            Generate New Invite
          </button>
        </div>
      ) : (
        <button
          onClick={generateInvite}
          disabled={loading}
          className="w-full bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded transition"
        >
          {loading ? 'Generating...' : 'Generate New Invite Code'}
        </button>
      )}
    </div>
  )
}