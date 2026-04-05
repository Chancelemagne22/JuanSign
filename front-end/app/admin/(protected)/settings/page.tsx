'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// ── Constants ──────────────────────────────────────────────────────────────────

const FONT = 'var(--font-fredoka)'
const BROWN = 'var(--admin-brown-dark)'
const GOLD = 'var(--admin-gold)'
const CREAM = 'var(--admin-cream)'
const DIVIDER = 'var(--admin-divider)'
const INPUT_BORDER = 'var(--admin-input-border)'
const MEDIUM_BROWN = 'var(--admin-brown-medium)'
const ERROR_RED = 'var(--admin-error-red)'
const ERROR_DARK_RED = 'var(--admin-error-dark)'
const SUCCESS_GREEN = 'var(--admin-success-green)'
const GREEN_BRIGHT = 'var(--admin-green-bright)'
const GREEN_DARK = 'var(--admin-green-dark)'
const WHITE = 'var(--admin-white)'
const BROWN_MUTED = 'var(--admin-brown-muted)'
const DISABLED_GRAY = 'var(--admin-disabled-gray)'
const DISABLED_BG = 'var(--admin-disabled-bg)'
const DISABLED_BORDER = 'var(--admin-disabled-border)'
const TAN_STRIPED = 'var(--admin-tan-striped)'
const CREAM_VARIANT = 'var(--admin-cream-variant)'
const RED_BRIGHT = 'var(--admin-red-bright)'
const TABLE_TEXT_SIZE = '0.76rem'

// ── Types ──────────────────────────────────────────────────────────────────────

interface SystemInfo {
  supabase: string
  modal: string
  appVersion: string
  environment: string
  lastUpdate: string
  adminEmail: string
}

type Section = 'email' | 'password' | 'delete' | null

// ── Shared input style ─────────────────────────────────────────────────────────

const inputCls =
  'w-full px-3 py-2 rounded-lg bg-white focus:outline-none text-sm'
const inputStyle = (focused?: boolean): React.CSSProperties => ({
  fontFamily: FONT,
  color: BROWN,
  border: `1.5px solid ${focused ? MEDIUM_BROWN : INPUT_BORDER}`,
  fontSize: TABLE_TEXT_SIZE,
})

// ── Pill Button ────────────────────────────────────────────────────────────────

function PillButton({
  label,
  onClick,
  variant = 'default',
  disabled,
}: {
  label: string
  onClick: () => void
  variant?: 'default' | 'red' | 'green'
  disabled?: boolean
}) {
  const bg =
    variant === 'red'
      ? ERROR_DARK_RED
      : variant === 'green'
      ? SUCCESS_GREEN
      : WHITE
  const color =
    variant === 'red' || variant === 'green' ? WHITE : BROWN
  const border =
    variant === 'red'
      ? 'none'
      : variant === 'green'
      ? 'none'
      : `1.5px solid ${INPUT_BORDER}`

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: FONT,
        fontSize: TABLE_TEXT_SIZE,
        fontWeight: 600,
        color: disabled ? DISABLED_GRAY : color,
        backgroundColor: disabled ? DISABLED_BG : bg,
        border: disabled ? `1.5px solid ${DISABLED_BORDER}` : border,
        borderRadius: '999px',
        padding: '6px 18px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  )
}

// ── Section Row ────────────────────────────────────────────────────────────────

function AccountRow({
  label,
  subtitle,
  rightContent,
  expanded,
  children,
}: {
  label: string
  subtitle: string
  rightContent: React.ReactNode
  expanded: boolean
  children?: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between px-6 py-4">
        {/* Left */}
        <div>
          <p style={{ fontFamily: FONT, color: BROWN, fontWeight: 700, fontSize: TABLE_TEXT_SIZE }}>
            {label}
          </p>
          <p style={{ fontFamily: FONT, color: BROWN_MUTED, fontSize: TABLE_TEXT_SIZE, marginTop: '2px' }}>
            {subtitle}
          </p>
        </div>
        {/* Right */}
        <div className="flex items-center gap-3">{rightContent}</div>
      </div>
      {/* Inline expanded form */}
      {expanded && children && (
        <div
          className="px-6 pb-5"
          style={{ borderTop: `1px solid ${DIVIDER}`, paddingTop: '16px' }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

// ── Toast ──────────────────────────────────────────────────────────────────────

function Toast({ msg, ok }: { msg: string; ok: boolean }) {
  return (
    <div
      className="fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg"
      style={{
        fontFamily: FONT,
        color: WHITE,
        backgroundColor: ok ? SUCCESS_GREEN : ERROR_RED,
        fontSize: '0.95rem',
        maxWidth: '360px',
      }}
    >
      {msg}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AdminSettingsPage() {
  const router = useRouter()

  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null)
  const [loadingSys, setLoadingSys] = useState(true)
  const [expanded, setExpanded] = useState<Section>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  // Email form
  const [newEmail, setNewEmail] = useState('')
  const [emailFocused, setEmailFocused] = useState(false)
  const [emailCurrentPw, setEmailCurrentPw] = useState('')
  const [emailPwFocused, setEmailPwFocused] = useState(false)

  // Password form
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwFocus, setPwFocus] = useState<Record<string, boolean>>({})

  // Delete form
  const [deleteInput, setDeleteInput] = useState('')
  const [deleteFocused, setDeleteFocused] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [saving, setSaving] = useState(false)

  // Load system info on mount
  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((d) => setSysInfo(d))
      .finally(() => setLoadingSys(false))
  }, [])

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  const toggle = (section: Section) =>
    setExpanded((prev) => (prev === section ? null : section))

  // ── Email change ────────────────────────────────────────────────────

  const handleEmailSave = async () => {
    if (!newEmail.trim()) return showToast('Please enter a new email address.', false)
    if (!newEmail.includes('@')) return showToast('Please enter a valid email address.', false)
    if (!emailCurrentPw) return showToast('Please enter your current password.', false)
    setSaving(true)
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'change-email', currentPassword: emailCurrentPw, newValue: newEmail }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) return showToast(data.error, false)
    showToast(data.message, true)
    setExpanded(null)
    setNewEmail('')
    setEmailCurrentPw('')
  }

  // ── Password change ─────────────────────────────────────────────────

  const handlePasswordSave = async () => {
    if (!currentPw) return showToast('Please enter your current password.', false)
    if (newPw.length < 6) return showToast('New password must be at least 6 characters.', false)
    if (newPw !== confirmPw) return showToast('New passwords do not match.', false)
    setSaving(true)
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'change-password', currentPassword: currentPw }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) return showToast(data.error, false)
    showToast(data.message, true)
    setExpanded(null)
    setCurrentPw('')
    setNewPw('')
    setConfirmPw('')
  }

  // ── Delete account ──────────────────────────────────────────────────

  const handleDelete = async () => {
    if (deleteInput !== 'DELETE') return
    setDeleting(true)
    await fetch('/api/admin/logout', { method: 'POST' })
    router.push('/admin/login')
  }

  // ── System info rows ────────────────────────────────────────────────

  const sysRows = sysInfo
    ? [
        { label: 'Application Name', value: 'JuanSign' },
        { label: 'System Version', value: sysInfo.appVersion },
        { label: 'Deployment Status', value: 'Running' },
        { label: 'Environment', value: sysInfo.environment },
        { label: 'Last System Update', value: sysInfo.lastUpdate },
        {
          label: 'Server Status',
          value: sysInfo.supabase,
          isStatus: true,
          online: sysInfo.supabase === 'Online',
        },
      ]
    : []

  return (
    <div className="h-full min-h-0 grid grid-cols-1 xl:grid-cols-2 items-start gap-4 sm:gap-5 w-full max-w-7xl pt-3 sm:pt-4 overflow-y-auto xl:overflow-hidden">
      {toast && <Toast msg={toast.msg} ok={toast.ok} />}

      {/* ── Admin Account ─────────────────────────────────────────────── */}
      <div className="min-h-0 flex flex-col xl:overflow-auto xl:pr-1">
        <h2
          className="font-bold mb-4"
          style={{ fontFamily: FONT, color: BROWN, fontSize: '1.2rem' }}
        >
          Admin Account
        </h2>

        <div
          className="rounded-2xl overflow-hidden shadow-sm"
          style={{ backgroundColor: CREAM }}
        >
          {/* Email row */}
          <AccountRow
            label="Email Address"
            subtitle="The email address associated with your account."
            expanded={expanded === 'email'}
            rightContent={
              <>
                {sysInfo && (
                  <span style={{ fontFamily: FONT, color: BROWN, fontSize: TABLE_TEXT_SIZE }}>
                    {sysInfo.adminEmail}
                  </span>
                )}
                <PillButton
                  label="Edit ✏"
                  onClick={() => toggle('email')}
                  variant="default"
                />
              </>
            }
          >
            <div className="flex flex-col gap-3 max-w-sm">
              <div>
                <label style={{ fontFamily: FONT, color: BROWN, fontSize: TABLE_TEXT_SIZE, fontWeight: 600 }}>
                  New Email Address
                </label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className={inputCls}
                  style={inputStyle(emailFocused)}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  placeholder="new@example.com"
                />
              </div>
              <div>
                <label style={{ fontFamily: FONT, color: BROWN, fontSize: TABLE_TEXT_SIZE, fontWeight: 600 }}>
                  Current Password (to confirm)
                </label>
                <input
                  type="password"
                  value={emailCurrentPw}
                  onChange={(e) => setEmailCurrentPw(e.target.value)}
                  className={inputCls}
                  style={inputStyle(emailPwFocused)}
                  onFocus={() => setEmailPwFocused(true)}
                  onBlur={() => setEmailPwFocused(false)}
                  placeholder="••••••••"
                />
              </div>
              <div className="flex gap-2 mt-1">
                <PillButton label={saving ? 'Saving…' : 'Save'} onClick={handleEmailSave} variant="green" disabled={saving} />
                <PillButton label="Cancel" onClick={() => { setExpanded(null); setNewEmail(''); setEmailCurrentPw('') }} />
              </div>
            </div>
          </AccountRow>

          {/* Divider */}
          <div style={{ height: '1px', backgroundColor: DIVIDER }} />

          {/* Password row */}
          <AccountRow
            label="Password"
            subtitle="Set a unique password to protect your account."
            expanded={expanded === 'password'}
            rightContent={
              <PillButton label="Change Password" onClick={() => toggle('password')} />
            }
          >
            <div className="flex flex-col gap-2.5 w-full max-w-[22rem] min-w-0">
              {[
                { key: 'current', label: 'Current Password', val: currentPw, set: setCurrentPw },
                { key: 'new', label: 'New Password', val: newPw, set: setNewPw },
                { key: 'confirm', label: 'Confirm New Password', val: confirmPw, set: setConfirmPw },
              ].map(({ key, label, val, set }) => (
                <div key={key}>
                  <label style={{ fontFamily: FONT, color: BROWN, fontSize: '0.72rem', fontWeight: 600 }}>
                    {label}
                  </label>
                  <input
                    type="password"
                    value={val}
                    onChange={(e) => set(e.target.value)}
                    className="w-full min-w-0 px-2.5 py-1.5 rounded-lg bg-white focus:outline-none"
                    style={{ ...inputStyle(pwFocus[key]), fontSize: '0.7rem', lineHeight: 1.25 }}
                    onFocus={() => setPwFocus((p) => ({ ...p, [key]: true }))}
                    onBlur={() => setPwFocus((p) => ({ ...p, [key]: false }))}
                    placeholder="••••••••"
                  />
                </div>
              ))}
              <div className="flex gap-2 mt-1 flex-wrap">
                <button
                  onClick={handlePasswordSave}
                  disabled={saving}
                  style={{
                    fontFamily: FONT,
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: WHITE,
                    backgroundColor: saving ? DISABLED_BG : SUCCESS_GREEN,
                    border: saving ? `1.5px solid ${DISABLED_BORDER}` : 'none',
                    borderRadius: '999px',
                    padding: '5px 14px',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
                <button
                  onClick={() => { setExpanded(null); setCurrentPw(''); setNewPw(''); setConfirmPw('') }}
                  style={{
                    fontFamily: FONT,
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: BROWN,
                    backgroundColor: WHITE,
                    border: `1.5px solid ${INPUT_BORDER}`,
                    borderRadius: '999px',
                    padding: '5px 14px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </AccountRow>

          {/* Divider */}
          <div style={{ height: '1px', backgroundColor: DIVIDER }} />

          {/* Delete row */}
          <AccountRow
            label="Delete Account"
            subtitle="This will delete your account. Your account will be permanently deleted from JuanSign."
            expanded={expanded === 'delete'}
            rightContent={
              <PillButton label="Delete" onClick={() => toggle('delete')} variant="red" />
            }
          >
            <div className="flex flex-col gap-3 max-w-sm">
              <p style={{ fontFamily: FONT, color: ERROR_RED, fontSize: TABLE_TEXT_SIZE }}>
                This action cannot be undone. Type{' '}
                <strong>DELETE</strong> below to confirm.
              </p>
              <input
                type="text"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                className={inputCls}
                style={inputStyle(deleteFocused)}
                onFocus={() => setDeleteFocused(true)}
                onBlur={() => setDeleteFocused(false)}
                placeholder="Type DELETE to confirm"
              />
              <div className="flex gap-2 mt-1">
                <PillButton
                  label={deleting ? 'Deleting…' : 'Confirm Delete'}
                  onClick={handleDelete}
                  variant="red"
                  disabled={deleteInput !== 'DELETE' || deleting}
                />
                <PillButton label="Cancel" onClick={() => { setExpanded(null); setDeleteInput('') }} />
              </div>
            </div>
          </AccountRow>
        </div>
      </div>

      {/* ── System Information ────────────────────────────────────────── */}
      <div className="min-h-0 flex flex-col xl:overflow-auto xl:pl-1">
        <h2
          className="font-bold mb-4"
          style={{ fontFamily: FONT, color: BROWN, fontSize: '1.2rem' }}
        >
          System Information
        </h2>

        <div className="rounded-2xl overflow-hidden shadow-sm w-full" style={{ backgroundColor: CREAM }}>
          {loadingSys ? (
            <div className="flex flex-col">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className={`flex gap-0 ${i > 0 ? 'border-t' : ''}`}
                  style={{ borderColor: DIVIDER }}
                >
                  <div
                    className="flex-1 h-12 animate-pulse"
                    style={{ backgroundColor: i % 2 === 0 ? TAN_STRIPED : CREAM }}
                  />
                  <div
                    className="flex-1 h-12 animate-pulse border-l"
                    style={{ backgroundColor: CREAM, borderColor: DIVIDER }}
                  />
                </div>
              ))}
            </div>
          ) : (
            sysRows.map((row, i) => (
              <div
                key={row.label}
                className={`grid ${i > 0 ? 'border-t' : ''}`}
                style={{ gridTemplateColumns: '1fr 1fr', borderColor: DIVIDER }}
              >
                {/* Label cell */}
                <div
                  className="px-6 py-3"
                  style={{ backgroundColor: i % 2 === 0 ? TAN_STRIPED : CREAM_VARIANT }}
                >
                  <span style={{ fontFamily: FONT, color: BROWN, fontSize: TABLE_TEXT_SIZE }}>
                    {row.label}
                  </span>
                </div>
                {/* Value cell */}
                <div
                  className="px-6 py-3 border-l flex items-center gap-2"
                  style={{ borderColor: DIVIDER, backgroundColor: i % 2 === 0 ? CREAM : CREAM }}
                >
                  {'isStatus' in row && row.isStatus && (
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: row.online ? GREEN_BRIGHT : RED_BRIGHT }}
                    />
                  )}
                  <span
                    style={{
                      fontFamily: FONT,
                      color:
                        'isStatus' in row && row.isStatus
                          ? row.online
                            ? GREEN_DARK
                            : ERROR_DARK_RED
                          : BROWN,
                      fontSize: TABLE_TEXT_SIZE,
                      fontWeight: 600,
                    }}
                  >
                    {row.value}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
