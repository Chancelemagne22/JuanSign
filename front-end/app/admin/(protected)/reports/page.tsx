'use client'

import { useEffect, useState, useCallback } from 'react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
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
  fontSize: '0.78rem',
  backgroundColor: WHITE,
  border: `1.5px solid ${DIVIDER}`,
  borderRadius: '8px',
  padding: '5px 28px 5px 9px',
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
    <div className="flex flex-col items-center gap-1.5">
      <p style={{ fontFamily: FONT, color: BROWN, fontSize: '0.8rem', textAlign: 'center' }}>
        {label}
      </p>
      <div
        className="w-full rounded-2xl flex items-center justify-center py-3 shadow-sm"
        style={{ backgroundColor: CREAM }}
      >
        <span className="text-2xl font-bold" style={{ fontFamily: FONT, color: GOLD }}>
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

  const handlePrintReport = () => {
    if (!data) return

    const levelLabel =
      filters.levelId === 'all'
        ? 'All levels'
        : levels.find((l) => l.level_id === filters.levelId)?.level_name ?? 'Selected level'

    const dateRangeMap: Record<string, string> = {
      '7': 'Last 7 days',
      '30': 'Last 30 days',
      '90': 'Last 90 days',
      all: 'All time',
    }

    const statusMap: Record<string, string> = {
      all: 'All',
      completed: 'Completed',
      failed: 'Failed',
    }

    const dateRangeLabel = dateRangeMap[filters.dateRange] ?? filters.dateRange
    const statusLabel = statusMap[filters.status] ?? filters.status

    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(18)
    doc.text('JuanSign Performance Report', 40, 44)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(
      `Generated: ${new Date().toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}`,
      40,
      62
    )
    doc.text(`Filters: Level ${levelLabel} | Date ${dateRangeLabel} | Status ${statusLabel}`, 40, 78)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text('Summary', 40, 102)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(`Assessments Taken: ${data.stats.assessmentsTaken}`, 40, 120)
    doc.text(`Average Accuracy: ${data.stats.avgAccuracy}%`, 40, 136)
    doc.text(`Overall Completion Rate: ${data.stats.completionRate}%`, 240, 120)
    doc.text(`Highest Completed Level: ${data.stats.highestLevel}`, 240, 136)

    autoTable(doc, {
      startY: 156,
      head: [['Level', 'Learners Attempted', 'Completion Rate', 'Average Score', 'Pass Rate']],
      body:
        data.levelPerformance.length > 0
          ? data.levelPerformance.map((row) => [
              row.levelName,
              row.learnersAttempted,
              `${row.completionRate}%`,
              `${row.avgScore}%`,
              `${row.passRate}%`,
            ])
          : [['No data for selected filters.', '', '', '', '']],
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [234, 224, 198], textColor: [93, 58, 26] },
      margin: { left: 40, right: 40 },
      didDrawPage: () => {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(12)
        doc.text('Level Performance', 40, 148)
      },
    })

    const levelTableEndY = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 156
    const learnerStartY = levelTableEndY + 28
    autoTable(doc, {
      startY: learnerStartY,
      head: [['User Name', 'Current Level', 'Attempts', 'Latest Score', 'Status']],
      body:
        data.learnerPerformance.length > 0
          ? data.learnerPerformance.map((row) => [
              row.username,
              row.currentLevel,
              row.attempts,
              `${row.latestScore}%`,
              row.status,
            ])
          : [['No learner data for selected filters.', '', '', '', '']],
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [234, 224, 198], textColor: [93, 58, 26] },
      margin: { left: 40, right: 40 },
      didDrawPage: () => {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(12)
        doc.text('Learner Performance', 40, learnerStartY - 8)
      },
    })

    const learnerTableEndY = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? learnerStartY
    const commonlyMissedStartY = learnerTableEndY + 26

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text('Commonly Missed Signs (Top 3)', 40, commonlyMissedStartY)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)

    if (data.commonlyMissed.length === 0) {
      doc.text('No data available.', 40, commonlyMissedStartY + 16)
    } else {
      data.commonlyMissed.slice(0, 3).forEach((item, index) => {
        doc.text(`• "${item.sign}" - ${item.percentIncorrect}% Incorrect`, 40, commonlyMissedStartY + 16 + index * 14)
      })
    }

    const pdfBlobUrl = doc.output('bloburl')

    const link = document.createElement('a')
    link.href = pdfBlobUrl
    link.target = '_blank'
    link.rel = 'noopener,noreferrer'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p style={{ fontFamily: FONT, color: ERROR_RED, fontSize: '1.1rem' }}>{error}</p>
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-3 sm:gap-4 overflow-y-auto lg:overflow-hidden">
      {/* ── Filters ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-2.5 sm:p-3 shrink-0" style={{ backgroundColor: 'transparent' }}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 sm:gap-3">
          {/* Level Selector */}
          <div>
            <p style={{ fontFamily: FONT, color: BROWN, fontSize: '0.74rem', marginBottom: '2px' }}>
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
            <p style={{ fontFamily: FONT, color: BROWN, fontSize: '0.74rem', marginBottom: '2px' }}>
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
            <p style={{ fontFamily: FONT, color: BROWN, fontSize: '0.74rem', marginBottom: '2px' }}>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5 sm:gap-3 shrink-0">
        {loading || !data ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <div className="h-4 w-32 rounded animate-pulse" style={{ backgroundColor: DIVIDER }} />
              <div className="w-full rounded-2xl py-3.5 animate-pulse" style={{ backgroundColor: CREAM, minHeight: '64px' }} />
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
      <div className="grid gap-4 sm:gap-5 flex-1 min-h-0 items-stretch xl:grid-cols-[minmax(0,1fr)_280px]">
        {/* Left column */}
        <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5 pr-1">
          {/* Level Performance Table */}
          <div className="min-h-0 h-full flex flex-col">
            <h2
              className="text-center font-bold mb-2"
              style={{ fontFamily: FONT, color: BROWN, fontSize: '1rem' }}
            >
              Level Performance Table
            </h2>
            {loading || !data ? (
              <div className="flex-1 min-h-0">
                <TableSkeleton cols={5} />
              </div>
            ) : (
              <div className="rounded-2xl overflow-hidden shadow-sm min-h-0 flex-1 flex flex-col" style={{ backgroundColor: CREAM }}>
                {/* Header */}
                <div
                  className="grid px-5 py-2.5 items-stretch"
                  style={{ gridTemplateColumns: '1fr 1.2fr 1.2fr 1.1fr 1fr' }}
                >
                  {['Level', 'Learners Attempted', 'Completion Rate', 'Average Score', 'Pass Rate'].map(
                    (h, i) => (
                      <span
                        key={i}
                        className="h-full flex items-center justify-center text-center break-words leading-tight px-1"
                        style={{ fontFamily: FONT, color: GOLD, fontSize: '0.74rem', fontWeight: 600 }}
                      >
                        {h}
                      </span>
                    )
                  )}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
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
                          className="grid px-5 py-2.5 border-t"
                          style={{
                            gridTemplateColumns: '1fr 1.2fr 1.2fr 1.1fr 1fr',
                            borderColor: DIVIDER,
                            backgroundColor: isLow ? RED_LIGHT_BG : 'transparent',
                          }}
                        >
                          <span style={{ fontFamily: FONT, color: isLow ? ERROR_RED : BROWN, fontSize: '0.86rem' }}>
                            {row.levelName}
                          </span>
                          <span className="text-center" style={{ fontFamily: FONT, color: isLow ? ERROR_RED : BROWN, fontSize: '0.86rem' }}>
                            {row.learnersAttempted}
                          </span>
                          <span className="text-center" style={{ fontFamily: FONT, color: isLow ? ERROR_RED : BROWN, fontSize: '0.86rem' }}>
                            {row.completionRate}%
                          </span>
                          <span className="text-center" style={{ fontFamily: FONT, color: isLow ? ERROR_RED : BROWN, fontSize: '0.86rem' }}>
                            {row.avgScore}%
                          </span>
                          <span className="text-center" style={{ fontFamily: FONT, color: isLow ? ERROR_RED : BROWN, fontSize: '0.86rem', fontWeight: isLow ? 700 : 400 }}>
                            {row.passRate}%
                          </span>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Learner Performance Table */}
          <div className="min-h-0 h-full flex flex-col">
            <h2
              className="text-center font-bold mb-2"
              style={{ fontFamily: FONT, color: BROWN, fontSize: '1rem' }}
            >
              Learner Performance Table
            </h2>
            {loading || !data ? (
              <div className="flex-1 min-h-0">
                <TableSkeleton cols={5} />
              </div>
            ) : (
              <div className="rounded-2xl overflow-hidden shadow-sm min-h-0 flex-1 flex flex-col" style={{ backgroundColor: CREAM }}>
                {/* Header */}
                <div
                  className="grid px-5 py-2.5 items-stretch"
                  style={{ gridTemplateColumns: '1.5fr 1fr 0.8fr 1fr 0.8fr' }}
                >
                  {['User Name', 'Current Level', 'Attempts', 'Latest Score', 'Status'].map(
                    (h, i) => (
                      <span
                        key={i}
                        className="h-full flex items-center justify-center text-center break-words leading-tight px-1"
                        style={{ fontFamily: FONT, color: GOLD, fontSize: '0.74rem', fontWeight: 600 }}
                      >
                        {h}
                      </span>
                    )
                  )}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
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
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="min-h-0 h-full flex flex-col gap-4 sm:gap-5">
          {/* Commonly Missed Signs */}
          <div className="rounded-2xl p-4 shrink-0" style={{ backgroundColor: CREAM }}>
            <h2
              className="font-bold mb-2.5 text-center"
              style={{ fontFamily: FONT, color: BROWN, fontSize: '0.9rem' }}
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
              <p style={{ fontFamily: FONT, color: GOLD, fontSize: '0.78rem', textAlign: 'center' }}>
                No data available.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {data.commonlyMissed.slice(0, 3).map((item, i) => (
                  <p
                    key={i}
                    className="break-words leading-tight"
                    style={{ fontFamily: FONT, color: BROWN, fontSize: '0.78rem', textAlign: 'center' }}
                  >
                    &ldquo;{item.sign}&rdquo; &ndash; {item.percentIncorrect}% Incorrect
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* Export Options */}
          <div className="rounded-2xl p-5 mt-auto shrink-0" style={{ backgroundColor: CREAM }}>
            <h2
              className="font-bold mb-4 text-center"
              style={{ fontFamily: FONT, color: GOLD, fontSize: '1.05rem' }}
            >
              Export Options
            </h2>
            <div className="flex flex-col gap-3">
              <button
                onClick={handlePrintReport}
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
                Open PDF Report
              </button>

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
