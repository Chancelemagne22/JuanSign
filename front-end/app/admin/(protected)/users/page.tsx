'use client'

import { useEffect, useState, useMemo } from 'react'
import { adminFetch } from '@/lib/adminFetch'
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

// ── Sort icon ──────────────────────────────────────────────────────────────────

function SortIcon({ active, asc }: { active: boolean; asc: boolean }) {
  return (
    <span className="ml-1 inline-block" style={{ color: active ? GOLD : GOLD_LIGHT, fontSize: '0.65rem' }}>
      {active ? (asc ? '▲' : '▼') : '⇅'}
    </span>
  )
}

// ── User Detail View ───────────────────────────────────────────────────────────

function UserDetailView({ user, onUserDeleted }: { user: AdminUser; onUserDeleted?: () => void }) {
  const [showDeleteWarning, setShowDeleteWarning] = useState(false)
  const [countdown, setCountdown] = useState(10)
  const [isDeleting, setIsDeleting] = useState(false)

  // Countdown timer
  useEffect(() => {
    if (!showDeleteWarning) return
    setCountdown(10)
  }, [showDeleteWarning])

  useEffect(() => {
    if (!showDeleteWarning || countdown === 0) return
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(timer)
  }, [showDeleteWarning, countdown])

  const rows: [string, string][] = [
    ['User ID', user.displayId],
    ['Email', user.email],
    ['Current Level', user.currentLevel],
    ['Levels Completed', user.levelsCompleted],
    ['Last Active', formatLastActive(user.lastActive)],
    ['Average Accuracy', `${user.avgAccuracy}%`],
  ]

  async function handleDeleteUser() {
    setIsDeleting(true)
    try {
      const res = await adminFetch(`/api/admin/users?authUserId=${encodeURIComponent(user.authUserId)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const err = await res.json()
        alert(`Failed to delete user: ${err.error}`)
        return
      }
      alert('User deleted successfully!')
      setShowDeleteWarning(false)
      onUserDeleted?.()
    } catch (error) {
      alert(`Error deleting user: ${error}`)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      {/* Delete Warning Modal Overlay */}
      {showDeleteWarning && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4"
          onClick={() => setShowDeleteWarning(false)}
        >
          <div
            className="rounded-2xl p-8 max-w-sm"
            style={{ backgroundColor: CREAM }}
            onClick={(e) => e.stopPropagation()}
          >
            {countdown > 0 ? (
              <>
                <h3 className="text-center text-lg font-bold mb-3" style={{ fontFamily: FONT, color: ERROR_RED }}>
                  ⚠️ Delete Account Warning
                </h3>
                <p className="text-center mb-4" style={{ fontFamily: FONT, color: BROWN, fontSize: '0.95rem' }}>
                  Are you sure you want to permanently delete this user account?
                </p>
                <p className="text-center mb-6" style={{ fontFamily: FONT, color: MEDIUM_BROWN, fontSize: '0.9rem' }}>
                  <strong>{user.fullName}</strong> ({user.email})
                </p>
                <div className="text-center mb-6">
                  <p style={{ fontFamily: FONT, color: BROWN, fontSize: '0.95rem' }}>
                    This action <strong>cannot be undone</strong>. All user data will be permanently deleted.
                  </p>
                </div>
                <div
                  className="text-center py-4 rounded-lg mb-6"
                  style={{ backgroundColor: MEDIUM_BROWN }}
                >
                  <p style={{ fontFamily: FONT, color: 'white', fontSize: '1.2rem', fontWeight: 'bold' }}>
                    {countdown}s
                  </p>
                  <p style={{ fontFamily: FONT, color: 'white', fontSize: '0.85rem' }}>
                    Delete button will appear shortly...
                  </p>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-center text-lg font-bold mb-4" style={{ fontFamily: FONT, color: ERROR_RED }}>
                  ⚠️ Confirm Deletion
                </h3>
                <p className="text-center mb-6" style={{ fontFamily: FONT, color: BROWN, fontSize: '0.95rem' }}>
                  Delete user <strong>{user.fullName}</strong>?
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeleteWarning(false)}
                    disabled={isDeleting}
                    className="flex-1 py-2 rounded-lg font-bold transition-colors"
                    style={{
                      fontFamily: FONT,
                      backgroundColor: MEDIUM_BROWN,
                      color: 'white',
                      opacity: isDeleting ? 0.5 : 1,
                      cursor: isDeleting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteUser}
                    disabled={isDeleting}
                    className="flex-1 py-2 rounded-lg font-bold transition-colors"
                    style={{
                      fontFamily: FONT,
                      backgroundColor: ERROR_RED,
                      color: 'white',
                      opacity: isDeleting ? 0.5 : 1,
                      cursor: isDeleting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isDeleting ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* User Detail Card */}
      <div className="rounded-2xl overflow-hidden shadow-sm min-h-0 h-full flex flex-col" style={{ backgroundColor: CREAM }}>
        {/* Title */}
        <div className="px-5 py-2 border-b" style={{ borderColor: DIVIDER }}>
          <h2 className="text-center text-base font-bold" style={{ fontFamily: FONT, color: GOLD }}>
            User Detail View
          </h2>
        </div>

        {/* Avatar + name + status (top) */}
        <div className="flex flex-col items-center justify-center px-5 py-3 border-b" style={{ borderColor: DIVIDER }}>
          <div
            className="w-16 h-16 rounded-xl overflow-hidden mb-1.5 flex items-center justify-center"
            style={{ backgroundColor: MEDIUM_BROWN }}
          >
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatarUrl} alt={user.fullName} className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl font-bold text-white" style={{ fontFamily: FONT }}>
                {user.fullName[0]?.toUpperCase()}
              </span>
            )}
          </div>
          <p className="font-bold text-center" style={{ fontFamily: FONT, color: BROWN, fontSize: '0.82rem' }}>
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
                fontSize: '0.76rem',
                fontWeight: 600,
              }}
            >
              {user.status}
            </span>
          </div>
        </div>

        {/* Detail rows (below profile block) */}
        <div className="flex-1 min-h-0">
          {rows.map(([label, value], i) => (
            <div
              key={label}
              className={`grid px-5 py-2 ${i > 0 ? 'border-t' : ''}`}
              style={{ gridTemplateColumns: 'minmax(0,0.46fr) minmax(0,0.54fr)', borderColor: DIVIDER }}
            >
              <span
                className="min-w-0 break-words pr-2 leading-tight"
                style={{ fontFamily: FONT, color: BROWN, fontSize: '0.78rem' }}
              >
                {label}
              </span>
              <span
                className="font-bold min-w-0 break-all leading-tight"
                style={{ fontFamily: FONT, color: BROWN, fontSize: '0.78rem' }}
              >
                {value}
              </span>
            </div>
          ))}
        </div>

        {/* Delete Button */}
        <div className="px-5 py-2.5 border-t mt-auto" style={{ borderColor: DIVIDER }}>
          <button
            onClick={() => setShowDeleteWarning(true)}
            className="w-full py-1 rounded-lg font-bold transition-colors"
            style={{
              fontFamily: FONT,
              backgroundColor: ERROR_RED,
              color: 'white',
              fontSize: '0.8rem',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
          >
            Delete Account
          </button>
        </div>
      </div>
    </>
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
  const [page, setPage] = useState(1)
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)

  useEffect(() => {
    adminFetch('/api/admin/users')
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

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
    setPage(1)
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
    <div className="h-full min-h-0 flex flex-col gap-4 overflow-y-auto lg:overflow-hidden">
      {/* Search bar */}
      <div className="shrink-0 mt-2 sm:mt-3">
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder="Search by name or email…"
          className="w-full max-w-[21rem] px-3.5 py-1.5 rounded-lg border-2 bg-white focus:outline-none"
          style={{ fontFamily: FONT, color: BROWN, borderColor: DIVIDER, fontSize: '0.88rem', boxShadow: 'none', outline: 'none' }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = MEDIUM_BROWN
            e.currentTarget.style.boxShadow = 'none'
            e.currentTarget.style.outline = 'none'
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = DIVIDER
            e.currentTarget.style.boxShadow = 'none'
            e.currentTarget.style.outline = 'none'
          }}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.44fr)] gap-4 min-h-0 flex-1 items-stretch">
        {/* Table card */}
        <div className="rounded-2xl overflow-hidden shadow-sm min-h-0 h-full flex flex-col" style={{ backgroundColor: CREAM }}>
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <p style={{ fontFamily: FONT, color: GOLD, fontSize: '1.1rem' }}>Loading users…</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div
                className="grid px-4 sm:px-6 py-2.5 border-b"
                style={{
                  gridTemplateColumns: '78px minmax(90px,0.95fr) minmax(150px,1.4fr) minmax(115px,1fr) 84px 88px',
                  borderColor: DIVIDER,
                }}
              >
                {COLUMNS.map((col) => (
                  <button
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className={`flex items-center gap-0.5 font-semibold transition-opacity hover:opacity-70 ${
                      col.align === 'center' ? 'justify-center' : col.align === 'right' ? 'justify-end' : ''
                    }`}
                    style={{ fontFamily: FONT, color: GOLD, fontSize: '0.82rem' }}
                  >
                    {col.label}
                    <SortIcon active={sortKey === col.key} asc={sortAsc} />
                  </button>
                ))}
              </div>

              {/* Rows (scrollable when content grows) */}
              <div className="overflow-y-auto max-h-[52dvh] xl:max-h-[68dvh]">
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
                        className="grid px-4 sm:px-6 py-2.5 border-t cursor-pointer transition-colors"
                        style={{
                          gridTemplateColumns: '78px minmax(90px,0.95fr) minmax(150px,1.4fr) minmax(115px,1fr) 84px 88px',
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
                        <span className="min-w-0" style={{ fontFamily: FONT, color: BROWN, fontSize: '0.82rem' }}>
                          {user.displayId}
                        </span>
                        <span className="min-w-0 break-words leading-tight" style={{ fontFamily: FONT, color: BROWN, fontSize: '0.82rem' }}>
                          {user.fullName}
                        </span>
                        <span className="min-w-0 break-all leading-tight" style={{ fontFamily: FONT, color: BROWN, fontSize: '0.8rem' }}>
                          {user.email}
                        </span>
                        <span
                          className="text-center min-w-0 break-words leading-tight"
                          style={{ fontFamily: FONT, color: BROWN, fontSize: '0.82rem' }}
                        >
                          {user.currentLevel}
                        </span>
                        <span
                          className="text-center"
                          style={{ fontFamily: FONT, color: BROWN, fontSize: '0.82rem' }}
                        >
                          {user.progress}%
                        </span>
                        <span
                          className="text-center"
                          style={{ fontFamily: FONT, color: BROWN, fontSize: '0.82rem' }}
                        >
                          {user.status}
                        </span>
                      </div>
                    )
                  })
                )}
              </div>

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
        <div className="min-h-0 h-full">
          {selectedUser ? (
            <UserDetailView
              user={selectedUser}
              onUserDeleted={() => {
                setSelectedUser(null)
                setAllUsers((prev) => prev.filter((u) => u.authUserId !== selectedUser.authUserId))
              }}
            />
          ) : (
            <div className="rounded-2xl shadow-sm h-full min-h-[12rem] flex items-center justify-center px-5" style={{ backgroundColor: CREAM }}>
              <p style={{ fontFamily: FONT, color: GOLD, fontSize: '0.95rem', textAlign: 'center' }}>
                Select a user from the table to view details.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
