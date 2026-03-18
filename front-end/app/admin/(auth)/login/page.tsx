'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Invalid credentials.')
      } else {
        router.push('/admin')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: '#FFF8DC' }}
    >
      <div className="w-full max-w-md px-4">
        {/* Logo */}
        <div className="flex items-center justify-center gap-1 mb-8">
          <span
            style={{
              fontFamily: 'var(--font-spicy-rice)',
              fontSize: '2rem',
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
              fontSize: '1.6rem',
              fontWeight: 700,
              color: '#5D3A1A',
            }}
          >
            ADMIN
          </span>
        </div>

        {/* Card */}
        <div className="rounded-2xl shadow-md p-8" style={{ backgroundColor: '#FFFDE7' }}>
          <h2
            className="text-2xl font-bold mb-6 text-center"
            style={{ fontFamily: 'var(--font-fredoka)', color: '#5D3A1A' }}
          >
            Sign in to your account
          </h2>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label
                className="block mb-1 font-semibold"
                style={{ fontFamily: 'var(--font-fredoka)', color: '#5D3A1A' }}
              >
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="admin@juansign.com"
                className="w-full px-4 py-3 rounded-xl border-2 bg-white focus:outline-none"
                style={{
                  fontFamily: 'var(--font-fredoka)',
                  color: '#5D3A1A',
                  borderColor: '#E8D8A0',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#B5621E')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#E8D8A0')}
              />
            </div>

            <div>
              <label
                className="block mb-1 font-semibold"
                style={{ fontFamily: 'var(--font-fredoka)', color: '#5D3A1A' }}
              >
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-12 rounded-xl border-2 bg-white focus:outline-none"
                  style={{
                    fontFamily: 'var(--font-fredoka)',
                    color: '#5D3A1A',
                    borderColor: '#E8D8A0',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#B5621E')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#E8D8A0')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-sm"
                  style={{ fontFamily: 'var(--font-fredoka)', color: '#B5621E' }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {error && (
              <p
                className="text-sm"
                style={{ fontFamily: 'var(--font-fredoka)', color: '#B91C1C' }}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl font-bold text-lg text-white transition-all disabled:opacity-60"
              style={{ fontFamily: 'var(--font-fredoka)', backgroundColor: '#B5621E' }}
              onMouseEnter={(e) => {
                if (!loading) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#9A4E18'
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#B5621E'
              }}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
