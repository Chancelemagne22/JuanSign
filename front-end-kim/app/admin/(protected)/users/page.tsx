'use client'

import { useEffect, useState, useMemo } from 'react'
import type { AdminUser } from '@/app/api/admin/users/route'

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatLastActive(timestamp: string | null): string {
  if (!timestamp) return 'Never'
  const diff = Date.now() - new Date(timestamp).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 2) return 'Active Now'
  if (minutes < 60) return `${minutes} Minutes Ago`
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 24) return `${hours} Hour${hours !== 1 ? 's' : ''} Ago`
  const days = Math.floor(diff / 86_400_000)
  return `${days} Day${days !== 1 ? 's' : ''} Ago`
}

type SortKey = keyof Pick<
  AdminUser,
  'displayId' | 'fullName' | 'email' | 'currentLevel' | 'progress' | 'status'
>

const FONT = 'var(--font-fredoka)'
const BROWN = 'var(--admin-brown-dark)'
const GOLD = 'var(--admin-gold)'
const CREAM = 'var(--admin-cream)'
const DIVIDER = 'var(--admin-divider)'
const MEDIUM_BROWN = 'var(--admin-brown-medium)'
const GOLD_LIGHT = 'var(--admin-gold-light)'
const ERROR_RED = 'var(--admin-error-red)'
const GREEN_BRIGHT = 'var(--admin-green-bright)'
const GREEN_DARK = 'var(--admin-green-dark)'
const LIGHT_GRAY = 'var(--admin-light-gray)'
const MEDIUM_GRAY = 'var(--admin-medium-gray)'
const CREAM_HOVER = 'var(--admin-cream-hover)'
const CREAM_HOVER_LIGHT = 'var(--admin-cream-hover-light)'
const TAN_LIGHT = 'var(--admin-tan-light)'
const PAGE_SIZE = 20

// ── Checkbox ───────────────────────────────────────────────────────────────────

function Checkbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
      className="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors"
      style={{
        borderColor: checked ? MEDIUM_BROWN : GOLD,
        backgroundColor: checked ? MEDIUM_BROWN : 'transparent',
      }}
      aria-label={checked ? 'Deselect' : 'Select'}
    >
      {checked && (
        <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
          <path d="M1 4L4 7L10 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}

// ── Sort icon ──────────────────────────────────────────────────────────────────

function SortIcon({ active, asc }: { active: boolean; asc: boolean }) {
  return (
    <span className="ml-1 inline-block" style={{ color: active ? GOLD : GOLD_LIGHT, fontSize: '0.65rem' }}>
      {active ? (asc ? '▲' : '▼') : '⇅'}
    </span>
  )
}

// ── User Detail View ───────────────────────────────────────────────────────────

function UserDetailView({ user }: { user: AdminUser }) {
  const rows: [string, string][] = [
    ['User ID', user.displayId],
    ['Email', user.email],
    ['Current Level', user.currentLevel],
    ['Levels Completed', user.levelsCompleted],
    ['Last Active', formatLastActive(user.lastActive)],
    ['Average Accuracy', `${user.avgAccuracy}%`],
  ]

  return (
    <div className="rounded-2xl overflow-hidden shadow-sm mt-6" style={{ backgroundColor: CREAM }}>
      {/* Title */}
      <div className="px-8 py-4 border-b" style={{ borderColor: DIVIDER }}>
        <h2 className="text-center text-xl font-bold" style={{ fontFamily: FONT, color: GOLD }}>
          User Detail View
        </h2>
      </div>

      <div className="flex">
        {/* Detail rows */}
        <div className="flex-1">
          {rows.map(([label, value], i) => (
            <div
              key={label}
              className={`grid grid-cols-2 px-8 py-3 ${i > 0 ? 'border-t' : ''}`}
              style={{ borderColor: DIVIDER }}
            >
              <span style={{ fontFamily: FONT, color: BROWN, fontSize: '0.97rem' }}>{label}</span>
              <span
                className="font-bold"
                style={{ fontFamily: FONT, color: BROWN, fontSize: '0.97rem' }}
              >
                {value}
              </span>
            </div>
          ))}
        </div>

        {/* Avatar + name */}
        <div className="flex flex-col items-center justify-center px-10 py-6 border-l" style={{ borderColor: DIVIDER }}>
          <div
            className="w-28 h-28 rounded-2xl overflow-hidden mb-3 flex items-center justify-center"
            style={{ backgroundColor: MEDIUM_BROWN }}
          >
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatarUrl} alt={user.fullName} className="w-full h-full object-cover" />
            ) : (
              <span className="text-4xl font-bold text-white" style={{ fontFamily: FONT }}>
                {user.fullName[0]?.toUpperCase()}
              </span>
            )}
          </div>
          <p className="font-bold text-center" style={{ fontFamily: FONT, color: BROWN, fontSize: '1rem' }}>
            {user.fullName}
          </p>
          <div className="flex items-center gap-1 mt-1">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: user.status === 'Active' ? GREEN_BRIGHT : LIGHT_GRAY }}
            />
            <span
              style={{
                fontFamily: FONT,
                color: user.status === 'Active' ? GREEN_DARK : MEDIUM_GRAY,
                fontSize: '0.9rem',
                fontWeight: 600,
              }}
            >
              {user.status}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const [allUsers, setAllUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('displayId')
  const [sortAsc, setSortAsc] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)

  useEffect(() => {
    fetch('/api/admin/users')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setAllUsers(d.users)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  // Filter + sort
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return allUsers
      .filter(
        (u) =>
          !q ||
          u.fullName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        const av = a[sortKey]
        const bv = b[sortKey]
        if (typeof av === 'number' && typeof bv === 'number') {
          return sortAsc ? av - bv : bv - av
        }
        return sortAsc
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av))
      })
  }, [allUsers, search, sortKey, sortAsc])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const allOnPageSelected =
    paginated.length > 0 && paginated.every((u) => selected.has(u.authUserId))

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
    setPage(1)
  }

  const toggleSelectAll = () => {
    if (allOnPageSelected) {
      setSelected((prev) => {
        const next = new Set(prev)
        paginated.forEach((u) => next.delete(u.authUserId))
        return next
      })
    } else {
      setSelected((prev) => {
        const next = new Set(prev)
        paginated.forEach((u) => next.add(u.authUserId))
        return next
      })
    }
  }

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleRowClick = (user: AdminUser) => {
    setSelectedUser((prev) => (prev?.authUserId === user.authUserId ? null : user))
  }

  const COLUMNS: { key: SortKey; label: string; align?: 'center' | 'right' }[] = [
    { key: 'displayId', label: 'User ID' },
    { key: 'fullName', label: 'User Name' },
    { key: 'email', label: 'Email' },
    { key: 'currentLevel', label: 'Current Level', align: 'center' },
    { key: 'progress', label: 'Progress(%)', align: 'center' },
    { key: 'status', label: 'Status', align: 'center' },
  ]

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p style={{ fontFamily: FONT, color: ERROR_RED, fontSize: '1.1rem' }}>{error}</p>
      </div>
    )
  }

  return (
    <div>
      {/* Search bar */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder="Search by name or email…"
          className="w-full max-w-sm px-4 py-2 rounded-xl border-2 bg-white focus:outline-none"
          style={{ fontFamily: FONT, color: BROWN, borderColor: DIVIDER, fontSize: '0.97rem' }}
          onFocus={(e) => (e.currentTarget.style.borderColor = MEDIUM_BROWN)}
          onBlur={(e) => (e.currentTarget.style.borderColor = DIVIDER)}
        />
      </div>

      {/* Table card */}
      <div className="rounded-2xl overflow-hidden shadow-sm" style={{ backgroundColor: CREAM }}>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <p style={{ fontFamily: FONT, color: GOLD, fontSize: '1.1rem' }}>Loading users…</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div
              className="grid px-6 py-3 border-b"
              style={{
                gridTemplateColumns: '40px 90px 1fr 1fr 120px 100px 90px',
                borderColor: DIVIDER,
              }}
            >
              <div className="flex items-center">
                <Checkbox checked={allOnPageSelected} onChange={toggleSelectAll} />
              </div>
              {COLUMNS.map((col) => (
                <button
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className={`flex items-center gap-0.5 font-semibold transition-opacity hover:opacity-70 ${
                    col.align === 'center' ? 'justify-center' : col.align === 'right' ? 'justify-end' : ''
                  }`}
                  style={{ fontFamily: FONT, color: GOLD, fontSize: '0.97rem' }}
                >
                  {col.label}
                  <SortIcon active={sortKey === col.key} asc={sortAsc} />
                </button>
              ))}
            </div>

            {/* Rows */}
            {paginated.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <p style={{ fontFamily: FONT, color: GOLD }}>No users found.</p>
              </div>
            ) : (
              paginated.map((user) => {
                const isRowSelected = selectedUser?.authUserId === user.authUserId
                return (
                  <div
                    key={user.authUserId}
                    onClick={() => handleRowClick(user)}
                    className="grid px-6 py-3 border-t cursor-pointer transition-colors"
                    style={{
                      gridTemplateColumns: '40px 90px 1fr 1fr 120px 100px 90px',
                      borderColor: DIVIDER,
                      backgroundColor: isRowSelected ? CREAM_HOVER : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!isRowSelected)
                        (e.currentTarget as HTMLDivElement).style.backgroundColor = CREAM_HOVER_LIGHT
                    }}
                    onMouseLeave={(e) => {
                      if (!isRowSelected)
                        (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'
                    }}
                  >
                    <div className="flex items-center">
                      <Checkbox
                        checked={selected.has(user.authUserId)}
                        onChange={() => toggleOne(user.authUserId)}
                      />
                    </div>
                    <span style={{ fontFamily: FONT, color: BROWN, fontSize: '0.97rem' }}>
                      {user.displayId}
                    </span>
                    <span style={{ fontFamily: FONT, color: BROWN, fontSize: '0.97rem' }}>
                      {user.fullName}
                    </span>
                    <span style={{ fontFamily: FONT, color: BROWN, fontSize: '0.97rem' }}>
                      {user.email}
                    </span>
                    <span
                      className="text-center"
                      style={{ fontFamily: FONT, color: BROWN, fontSize: '0.97rem' }}
                    >
                      {user.currentLevel}
                    </span>
                    <span
                      className="text-center"
                      style={{ fontFamily: FONT, color: BROWN, fontSize: '0.97rem' }}
                    >
                      {user.progress}%
                    </span>
                    <span
                      className="text-center"
                      style={{ fontFamily: FONT, color: BROWN, fontSize: '0.97rem' }}
                    >
                      {user.status}
                    </span>
                  </div>
                )
              })
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div
                className="flex items-center justify-center gap-3 px-6 py-4 border-t"
                style={{ borderColor: DIVIDER }}
              >
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-1.5 rounded-lg font-semibold disabled:opacity-40 transition-colors"
                  style={{ fontFamily: FONT, color: BROWN, backgroundColor: TAN_LIGHT }}
                >
                  ‹ Prev
                </button>
                <span style={{ fontFamily: FONT, color: BROWN, fontSize: '0.97rem' }}>
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-4 py-1.5 rounded-lg font-semibold disabled:opacity-40 transition-colors"
                  style={{ fontFamily: FONT, color: BROWN, backgroundColor: TAN_LIGHT }}
                >
                  Next ›
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* User Detail View */}
      {selectedUser && <UserDetailView user={selectedUser} />}
    </div>
  )
}
