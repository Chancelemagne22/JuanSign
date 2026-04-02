'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { validateInviteCode, completeAdminSignup } from '@/lib/adminInvites'
import { useRouter, useSearchParams } from 'next/navigation'

export default function AdminSetupPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'validate' | 'register' | 'error' | 'success'>('validate')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    const codeParam = searchParams.get('code')
    if (codeParam) {
      setCode(codeParam)
      validateCode(codeParam)
    }
  }, [searchParams])

  const validateCode = async (inviteCode: string) => {
    setLoading(true)
    setError('')

    try {
      const response = await fetch(`/api/admin/validate-invite?code=${encodeURIComponent(inviteCode)}`)
      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Invalid invite code')
        setStep('error')
      } else {
        setStep('register')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to validate invite code')
      setStep('error')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match')
      }

      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters')
      }

      const { data: authData, error: signupError } = await supabase.auth.signUp({
        email,
        password,
      })

      if (signupError) {
        throw signupError
      }

      if (!authData.user?.id) {
        throw new Error('Failed to create user account')
      }

      const response = await fetch('/api/admin/setup-admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inviteCode: code,
          userId: authData.user.id,
        }),
      })

      const setupData = await response.json()

      if (!response.ok) {
        throw new Error(setupData.error || 'Failed to complete admin setup')
      }

      setStep('success')
      setTimeout(() => {
        router.push('/admin')
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
      setStep('error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 to-yellow-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-8">
        <h1 className="text-3xl font-bold text-center mb-2" style={{ color: '#5D3A1A' }}>
          Admin Setup
        </h1>
        <p className="text-center text-gray-600 mb-6">Create your admin account</p>

        {error && step === 'error' && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            <div className="font-semibold">404 Not Found</div>
            <div className="text-sm mt-1">{error}</div>
          </div>
        )}

        {step === 'success' && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
            <div className="font-semibold">✓ Account Created</div>
            <div className="text-sm mt-1">Redirecting to admin dashboard...</div>
          </div>
        )}

        {step === 'validate' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Invite Code
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Enter your invite code"
                maxLength={8}
                className="w-full px-4 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
              />
            </div>

            <button
              onClick={() => code && validateCode(code)}
              disabled={!code || loading}
              className="w-full bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded transition"
            >
              {loading ? 'Validating...' : 'Validate Code'}
            </button>
          </div>
        )}

        {step === 'register' && (
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className="w-full px-4 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="w-full px-4 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="w-full px-4 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded transition"
            >
              {loading ? 'Creating Account...' : 'Create Admin Account'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}