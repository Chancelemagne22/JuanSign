'use client'

import { useEffect, useState, useCallback } from 'react'
import type { ReportData, LevelPerformanceRow, LearnerPerformanceRow } from '@/app/api/admin/reports/route'

// ── Constants ──────────────────────────────────────────────────────────────────

const FONT = 'var(--font-fredoka)'
const BROWN = 'var(--admin-brown-dark)'
const GOLD = 'var(--admin-gold)'
const CREAM = 'var(--admin-cream)'
const DIVIDER = 'var(--admin-divider)'
const WHITE = 'var(--admin-white)'
const ERROR_RED = 'var(--admin-error-red)'
const GREEN_DARK = 'var(--admin-green-dark)'
const RED_LIGHT_BG = 'var(--admin-red-light-bg)'
const TAN_LIGHT = 'var(--admin-tan-light)'

const INPUT_STYLE: React.CSSProperties = {
  fontFamily: FONT,
  color: BROWN,
  fontSize: '0.95rem',
  backgroundColor: WHITE,
  border: `1.5px solid ${DIVIDER}`,
  borderRadius: '8px',
  padding: '7px 30px 7px 12px',
  appearance: 'none',
  WebkitAppearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='7' viewBox='0 0 11 7'%3E%3Cpath d='M1 1l4.5 4.5L10 1' stroke='%235D3A1A' stroke-width='1.6' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 9px center',
  cursor: 'pointer',
  outline: 'none',
  width: '100%',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function toCSV(levelRows: LevelPerformanceRow[], learnerRows: LearnerPerformanceRow[]): string {
  const lines: string[] = []

  lines.push('Level Performance')
  lines.push('Level,Learners Attempted,Completion Rate,Average Score,Pass Rate')
  for (const r of levelRows) {
    lines.push(`"${r.levelName}",${r.learnersAttempted},${r.completionRate}%,${r.avgScore}%,${r.passRate}%`)
  }

  lines.push('')
  lines.push('Learner Performance')
  lines.push('User Name,Current Level,Attempts,Latest Score,Status')
  for (const r of learnerRows) {
    lines.push(`"${r.username}","${r.currentLevel}",${r.attempts},${r.latestScore}%,${r.status}`)
  }

  return lines.join('\n')
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function toExcelHTML(levelRows: LevelPerformanceRow[], learnerRows: LearnerPerformanceRow[]): string {
  const levelTableRows = levelRows
    .map(
      (r) =>
        `<tr><td>${r.levelName}</td><td>${r.learnersAttempted}</td><td>${r.completionRate}%</td><td>${r.avgScore}%</td><td>${r.passRate}%</td></tr>`
    )
    .join('')

  const learnerTableRows = learnerRows
    .map(
      (r) =>
        `<tr><td>${r.username}</td><td>${r.currentLevel}</td><td>${r.attempts}</td><td>${r.latestScore}%</td><td>${r.status}</td></tr>`
    )
    .join('')

  return `<html><body>
    <h2>Level Performance</h2>
    <table border="1">
      <tr><th>Level</th><th>Learners Attempted</th><th>Completion Rate</th><th>Average Score</th><th>Pass Rate</th></tr>
      ${levelTableRows}
    </table>
    <br/>
    <h2>Learner Performance</h2>
    <table border="1">
      <tr><th>User Name</th><th>Current Level</th><th>Attempts</th><th>Latest Score</th><th>Status</th></tr>
      ${learnerTableRows}
    </table>
  </body></html>`
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <p style={{ fontFamily: FONT, color: BROWN, fontSize: '0.95rem', textAlign: 'center' }}>
        {label}
      </p>
      <div
        className="w-full rounded-2xl flex items-center justify-center py-5 shadow-sm"
        style={{ backgroundColor: CREAM }}
      >
        <span className="text-4xl font-bold" style={{ fontFamily: FONT, color: GOLD }}>
          {value}
        </span>
      </div>
    </div>
  )
}

function TableSkeleton({ cols }: { cols: number }) {
  return (
    <div className="rounded-2xl overflow-hidden shadow-sm" style={{ backgroundColor: CREAM }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={`flex gap-4 px-5 py-3 ${i > 0 ? 'border-t' : ''}`} style={{ borderColor: DIVIDER }}>
          {Array.from({ length: cols }).map((__, j) => (
            <div
              key={j}
              className="h-4 flex-1 rounded animate-pulse"
              style={{ backgroundColor: DIVIDER }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

interface Filters {
  levelId: string
  dateRange: string
  status: string
}

interface Level { level_id: string; level_name: string }

export default function AdminReportsPage() {
  const [filters, setFilters] = useState<Filters>({ levelId: 'all', dateRange: '7', status: 'all' })
  const [levels, setLevels] = useState<Level[]>([])
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Load levels for selector
  useEffect(() => {
    fetch('/api/admin/levels-list')
      .then((r) => r.json())
      .then((d) => setLevels(d.levels ?? []))
  }, [])

  const loadReport = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      levelId: filters.levelId,
      dateRange: filters.dateRange,
      status: filters.status,
    })
    fetch(`/api/admin/reports?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [filters])

  useEffect(() => {
    loadReport()
  }, [loadReport])

  const setFilter = (key: keyof Filters, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }))

  const handleExportCSV = () => {
    if (!data) return
    const csv = toCSV(data.levelPerformance, data.learnerPerformance)
    downloadFile(csv, 'juansign-report.csv', 'text/csv;charset=utf-8;')
  }

  const handleExportExcel = () => {
    if (!data) return
    const html = toExcelHTML(data.levelPerformance, data.learnerPerformance)
    downloadFile(html, 'juansign-report.xls', 'application/vnd.ms-excel')
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p style={{ fontFamily: FONT, color: ERROR_RED, fontSize: '1.1rem' }}>{error}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ── Filters ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-5" style={{ backgroundColor: CREAM }}>
        <div className="grid grid-cols-3 gap-5">
          {/* Level Selector */}
          <div>
            <p style={{ fontFamily: FONT, color: BROWN, fontSize: '0.9rem', marginBottom: '6px' }}>
              Level Selector
            </p>
            <select
              value={filters.levelId}
              onChange={(e) => setFilter('levelId', e.target.value)}
              style={INPUT_STYLE}
            >
              <option value="all">All levels</option>
              {levels.map((l) => (
                <option key={l.level_id} value={l.level_id}>{l.level_name}</option>
              ))}
            </select>
          </div>

          {/* Date Range */}
          <div>
            <p style={{ fontFamily: FONT, color: BROWN, fontSize: '0.9rem', marginBottom: '6px' }}>
              Date Range
            </p>
            <select
              value={filters.dateRange}
              onChange={(e) => setFilter('dateRange', e.target.value)}
              style={INPUT_STYLE}
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="all">All time</option>
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <p style={{ fontFamily: FONT, color: BROWN, fontSize: '0.9rem', marginBottom: '6px' }}>
              Status Filter
            </p>
            <select
              value={filters.status}
              onChange={(e) => setFilter('status', e.target.value)}
              style={INPUT_STYLE}
            >
              <option value="all">All</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Stat Cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4">
        {loading || !data ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <div className="h-4 w-32 rounded animate-pulse" style={{ backgroundColor: DIVIDER }} />
              <div className="w-full rounded-2xl py-5 animate-pulse" style={{ backgroundColor: CREAM, minHeight: '76px' }} />
            </div>
          ))
        ) : (
          <>
            <StatCard label="Assessments Taken" value={data.stats.assessmentsTaken} />
            <StatCard label="Average Accuracy" value={`${data.stats.avgAccuracy}%`} />
            <StatCard label="Overall Completion Rate" value={`${data.stats.completionRate}%`} />
            <StatCard label="Highest Completed Level" value={data.stats.highestLevel} />
          </>
        )}
      </div>

      {/* ── Main two-column section ───────────────────────────────────── */}
      <div className="grid gap-5" style={{ gridTemplateColumns: '1fr 280px' }}>
        {/* Left column */}
        <div className="flex flex-col gap-5">
          {/* Level Performance Table */}
          <div>
            <h2
              className="text-center font-bold mb-3"
              style={{ fontFamily: FONT, color: BROWN, fontSize: '1.1rem' }}
            >
              Level Performance Table
            </h2>
            {loading || !data ? (
              <TableSkeleton cols={5} />
            ) : (
              <div className="rounded-2xl overflow-hidden shadow-sm" style={{ backgroundColor: CREAM }}>
                {/* Header */}
                <div
                  className="grid px-5 py-3"
                  style={{ gridTemplateColumns: '1fr 1.2fr 1.2fr 1.1fr 1fr' }}
                >
                  {['Level', 'Learners Attempted', 'Completion Rate', 'Average Score', 'Pass Rate'].map(
                    (h, i) => (
                      <span
                        key={i}
                        className={i > 0 ? 'text-center' : ''}
                        style={{ fontFamily: FONT, color: GOLD, fontSize: '0.9rem', fontWeight: 600 }}
                      >
                        {h}
                      </span>
                    )
                  )}
                </div>

                {data.levelPerformance.length === 0 ? (
                  <div className="px-5 py-8 text-center border-t" style={{ borderColor: DIVIDER }}>
                    <p style={{ fontFamily: FONT, color: GOLD }}>No data for selected filters.</p>
                  </div>
                ) : (
                  data.levelPerformance.map((row) => {
                    const isLow = row.passRate < 50
                    return (
                      <div
                        key={row.levelId}
                        className="grid px-5 py-3 border-t"
                        style={{
                          gridTemplateColumns: '1fr 1.2fr 1.2fr 1.1fr 1fr',
                          borderColor: DIVIDER,
                          backgroundColor: isLow ? RED_LIGHT_BG : 'transparent',
                        }}
                      >
                        <span style={{ fontFamily: FONT, color: isLow ? ERROR_RED : BROWN, fontSize: '0.95rem' }}>
                          {row.levelName}
                        </span>
                        <span className="text-center" style={{ fontFamily: FONT, color: isLow ? ERROR_RED : BROWN, fontSize: '0.95rem' }}>
                          {row.learnersAttempted}
                        </span>
                        <span className="text-center" style={{ fontFamily: FONT, color: isLow ? ERROR_RED : BROWN, fontSize: '0.95rem' }}>
                          {row.completionRate}%
                        </span>
                        <span className="text-center" style={{ fontFamily: FONT, color: isLow ? ERROR_RED : BROWN, fontSize: '0.95rem' }}>
                          {row.avgScore}%
                        </span>
                        <span className="text-center" style={{ fontFamily: FONT, color: isLow ? ERROR_RED : BROWN, fontSize: '0.95rem', fontWeight: isLow ? 700 : 400 }}>
                          {row.passRate}%
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>

          {/* Learner Performance Table */}
          <div>
            <h2
              className="text-center font-bold mb-3"
              style={{ fontFamily: FONT, color: BROWN, fontSize: '1.1rem' }}
            >
              Learner Performance Table
            </h2>
            {loading || !data ? (
              <TableSkeleton cols={5} />
            ) : (
              <div className="rounded-2xl overflow-hidden shadow-sm" style={{ backgroundColor: CREAM }}>
                {/* Header */}
                <div
                  className="grid px-5 py-3"
                  style={{ gridTemplateColumns: '1.5fr 1fr 0.8fr 1fr 0.8fr' }}
                >
                  {['User Name', 'Current Level', 'Attempts', 'Latest Score', 'Status'].map(
                    (h, i) => (
                      <span
                        key={i}
                        className={i > 0 ? 'text-center' : ''}
                        style={{ fontFamily: FONT, color: GOLD, fontSize: '0.9rem', fontWeight: 600 }}
                      >
                        {h}
                      </span>
                    )
                  )}
                </div>

                {data.learnerPerformance.length === 0 ? (
                  <div className="px-5 py-8 text-center border-t" style={{ borderColor: DIVIDER }}>
                    <p style={{ fontFamily: FONT, color: GOLD }}>No learner data for selected filters.</p>
                  </div>
                ) : (
                  data.learnerPerformance.map((row, i) => (
                    <div
                      key={i}
                      className="grid px-5 py-3 border-t"
                      style={{ gridTemplateColumns: '1.5fr 1fr 0.8fr 1fr 0.8fr', borderColor: DIVIDER }}
                    >
                      <span style={{ fontFamily: FONT, color: BROWN, fontSize: '0.95rem' }}>
                        {row.username}
                      </span>
                      <span className="text-center" style={{ fontFamily: FONT, color: BROWN, fontSize: '0.95rem' }}>
                        {row.currentLevel}
                      </span>
                      <span className="text-center" style={{ fontFamily: FONT, color: BROWN, fontSize: '0.95rem' }}>
                        {row.attempts}
                      </span>
                      <span className="text-center" style={{ fontFamily: FONT, color: BROWN, fontSize: '0.95rem' }}>
                        {row.latestScore}%
                      </span>
                      <span
                        className="text-center"
                        style={{
                          fontFamily: FONT,
                          color: row.status === 'Passed' ? GREEN_DARK : ERROR_RED,
                          fontSize: '0.95rem',
                          fontWeight: 600,
                        }}
                      >
                        {row.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-5">
          {/* Commonly Missed Signs */}
          <div className="rounded-2xl p-5" style={{ backgroundColor: CREAM }}>
            <h2
              className="font-bold mb-4 text-center"
              style={{ fontFamily: FONT, color: BROWN, fontSize: '1.05rem' }}
            >
              Commonly Missed Signs
            </h2>
            {loading || !data ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-4 rounded animate-pulse" style={{ backgroundColor: DIVIDER }} />
                ))}
              </div>
            ) : data.commonlyMissed.length === 0 ? (
              <p style={{ fontFamily: FONT, color: GOLD, fontSize: '0.9rem', textAlign: 'center' }}>
                No data available.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {data.commonlyMissed.map((item, i) => (
                  <p
                    key={i}
                    style={{ fontFamily: FONT, color: BROWN, fontSize: '0.9rem', textAlign: 'center' }}
                  >
                    &ldquo;{item.sign}&rdquo; &ndash; {item.percentIncorrect}% Incorrect
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* Export Options */}
          <div className="rounded-2xl p-5" style={{ backgroundColor: CREAM }}>
            <h2
              className="font-bold mb-4 text-center"
              style={{ fontFamily: FONT, color: GOLD, fontSize: '1.05rem' }}
            >
              Export Options
            </h2>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleExportCSV}
                disabled={!data}
                className="w-full py-2.5 rounded-xl font-semibold transition-colors disabled:opacity-50"
                style={{
                  fontFamily: FONT,
                  color: BROWN,
                  fontSize: '0.95rem',
                  backgroundColor: WHITE,
                  border: `1.5px solid ${DIVIDER}`,
                  cursor: data ? 'pointer' : 'not-allowed',
                }}
                onMouseEnter={(e) => {
                  if (data) (e.currentTarget as HTMLButtonElement).style.backgroundColor = TAN_LIGHT
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = WHITE
                }}
              >
                Export Report As CSV
              </button>
              <button
                onClick={handleExportExcel}
                disabled={!data}
                className="w-full py-2.5 rounded-xl font-semibold transition-colors disabled:opacity-50"
                style={{
                  fontFamily: FONT,
                  color: BROWN,
                  fontSize: '0.95rem',
                  backgroundColor: WHITE,
                  border: `1.5px solid ${DIVIDER}`,
                  cursor: data ? 'pointer' : 'not-allowed',
                }}
                onMouseEnter={(e) => {
                  if (data) (e.currentTarget as HTMLButtonElement).style.backgroundColor = TAN_LIGHT
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = WHITE
                }}
              >
                Export Report As Excel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
