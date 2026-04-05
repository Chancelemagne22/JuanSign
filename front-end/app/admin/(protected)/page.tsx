'use client'

import { useEffect, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Stats {
  totalUsers: number
  activeUsersToday: number
  levelsCompletedToday: number
}

interface ActiveUser {
  username: string
  currentLevel: string
  lastActivity: string
}

interface CompletedLevel {
  username: string
  levelCompleted: string
  dateCompleted: string
}

interface DashboardData {
  recentlyActiveUsers: ActiveUser[]
  recentlyCompletedLevels: CompletedLevel[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime()
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (minutes < 1) return 'Just Now'
  if (minutes < 60) return `${minutes} Minute${minutes !== 1 ? 's' : ''} Ago`
  if (hours < 24) return `${hours} Hour${hours !== 1 ? 's' : ''} Ago`
  return `${days} Day${days !== 1 ? 's' : ''} Ago`
}

function formatDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <p
        className="text-center"
        style={{ fontFamily: 'var(--font-fredoka)', color: '#5D3A1A', fontSize: '0.95rem' }}
      >
        {label}
      </p>
      <div
        className="w-full rounded-2xl flex items-center justify-center py-4 sm:py-5 shadow-sm"
        style={{ backgroundColor: '#FFFDE7' }}
      >
        <span
          className="text-4xl font-bold leading-none"
          style={{ fontFamily: 'var(--font-fredoka)', color: '#C17A3A' }}
        >
          {value}
        </span>
      </div>
    </div>
  )
}

function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="rounded-2xl overflow-hidden shadow-sm" style={{ backgroundColor: '#FFFDE7' }}>
      {Array.from({ length: rows + 1 }).map((_, i) => (
        <div
          key={i}
          className={`grid grid-cols-3 px-6 py-4 gap-4 ${i > 0 ? 'border-t' : ''}`}
          style={{ borderColor: '#E8D8A0' }}
        >
          {[0, 1, 2].map((j) => (
            <div
              key={j}
              className="h-4 rounded animate-pulse"
              style={{ backgroundColor: '#E8D8A0', width: i === 0 ? '60%' : '80%' }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function RecentTable({
  title,
  headers,
  rows,
  emptyRows = 4,
}: {
  title: string
  headers: [string, string, string]
  rows: [string, string, string][]
  emptyRows?: number
}) {
  const placeholders = Math.max(0, emptyRows - rows.length)

  return (
    <div>
      <h2
        className="text-xl font-semibold mb-2"
        style={{ fontFamily: 'var(--font-fredoka)', color: '#5D3A1A' }}
      >
        {title}
      </h2>
      <div className="rounded-2xl overflow-hidden shadow-sm min-h-0" style={{ backgroundColor: '#FFFDE7' }}>
        {/* Header row */}
        <div className="grid grid-cols-3 px-4 sm:px-6 py-3 border-b" style={{ borderColor: '#E8D8A0' }}>
          {headers.map((h, i) => (
            <span
              key={i}
              className={`font-semibold ${i === 1 ? 'text-center' : i === 2 ? 'text-right' : ''}`}
              style={{ fontFamily: 'var(--font-fredoka)', color: '#C17A3A', fontSize: '1rem' }}
            >
              {h}
            </span>
          ))}
        </div>

        {/* Scrollable rows */}
        <div className="max-h-[40dvh] xl:max-h-[52dvh] overflow-y-auto">
          {/* Data rows */}
          {rows.map((row, i) => (
            <div
              key={i}
              className="grid grid-cols-3 px-4 sm:px-6 py-3 border-t"
              style={{ borderColor: '#E8D8A0' }}
            >
              {row.map((cell, j) => (
                <span
                  key={j}
                  className={j === 1 ? 'text-center' : j === 2 ? 'text-right' : ''}
                  style={{ fontFamily: 'var(--font-fredoka)', color: '#5D3A1A', fontSize: '0.97rem' }}
                >
                  {cell}
                </span>
              ))}
            </div>
          ))}

          {/* Empty placeholder rows */}
          {Array.from({ length: placeholders }).map((_, i) => (
            <div
              key={`ph-${i}`}
              className="grid grid-cols-3 px-4 sm:px-6 py-3 border-t"
              style={{ borderColor: '#E8D8A0' }}
            >
              {['—', '—', '—'].map((dash, j) => (
                <span
                  key={j}
                  className={j === 1 ? 'text-center' : j === 2 ? 'text-right' : ''}
                  style={{ fontFamily: 'var(--font-fredoka)', color: '#C17A3A' }}
                >
                  {dash}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/stats').then((r) => r.json()),
      fetch('/api/admin/dashboard').then((r) => r.json()),
    ])
      .then(([s, d]) => {
        if (s.error) throw new Error(s.error)
        setStats(s)
        setDashboardData(d)
      })
      .catch((err) => setError(err.message))
  }, [])

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p style={{ fontFamily: 'var(--font-fredoka)', color: '#B91C1C', fontSize: '1.1rem' }}>
          {error}
        </p>
      </div>
    )
  }

  const activeUserRows: [string, string, string][] =
    dashboardData?.recentlyActiveUsers.map((u) => [
      u.username,
      u.currentLevel,
      formatRelativeTime(u.lastActivity),
    ]) ?? []

  const completedLevelRows: [string, string, string][] =
    dashboardData?.recentlyCompletedLevels.map((l) => [
      l.username,
      l.levelCompleted,
      formatDate(l.dateCompleted),
    ]) ?? []

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 sm:gap-5 lg:gap-6 overflow-y-auto lg:overflow-hidden">
      {/* Stat cards */}
      <div className="mt-2 sm:mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 lg:gap-6 shrink-0">
        {stats ? (
          <>
            <StatCard label="Total Registered Users" value={stats.totalUsers} />
            <StatCard label="Active Users Today" value={stats.activeUsersToday} />
            <StatCard label="Levels Completed Today" value={stats.levelsCompletedToday} />
          </>
        ) : (
          <>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <div
                  className="h-5 w-40 rounded animate-pulse"
                  style={{ backgroundColor: '#E8D8A0' }}
                />
                <div
                  className="w-full rounded-2xl py-6 animate-pulse"
                  style={{ backgroundColor: '#FFFDE7', minHeight: '88px' }}
                />
              </div>
            ))}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5 min-h-0 lg:overflow-hidden">
        {/* Recently Active Users */}
        {dashboardData ? (
          <RecentTable
            title="Recently Active Users"
            headers={['User Name', 'Current Level', 'Last Activity']}
            rows={activeUserRows}
          />
        ) : (
          <div>
            <div
              className="h-6 w-52 rounded mb-3 animate-pulse"
              style={{ backgroundColor: '#E8D8A0' }}
            />
            <TableSkeleton />
          </div>
        )}

        {/* Recently Completed Levels */}
        {dashboardData ? (
          <RecentTable
            title="Recently Completed Levels"
            headers={['User Name', 'Level Completed', 'Date Completed']}
            rows={completedLevelRows}
          />
        ) : (
          <div>
            <div
              className="h-6 w-52 rounded mb-3 animate-pulse"
              style={{ backgroundColor: '#E8D8A0' }}
            />
            <TableSkeleton />
          </div>
        )}
      </div>
    </div>
  )
}
