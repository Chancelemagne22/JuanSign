'use client'

import { useEffect, useState, useCallback } from 'react'
import { adminFetch } from '@/lib/adminFetch'
import { VideoSelect } from '@/components/VideoSelect'
import { listLessonVideos, getLessonVideoUrl } from '@/lib/storage'

// ── Types ──────────────────────────────────────────────────────────────────────

type QuestionType = 'identify' | 'perform'
type Tab = 'lessons' | 'practice' | 'assessment'

interface Level { level_id: string; level_name: string }

interface Lesson {
  lesson_id: string
  lesson_title: string
  video_url: string
  content_text: string
  lesson_order: number
}

interface Question {
  question_id: string
  question_type: QuestionType
  question_text: string
  // identify
  video_url: string
  option_a: string
  option_b: string
  option_c: string
  option_d: string
  correct_answer: string
  // perform — practice
  target_sign: string
  reference_data: string
  // perform — assessment
  correct_sign: string
  // assessment only
  points: number
}

type QuestionDraft = Omit<Question, 'question_id'> & { question_id?: string; insertAt?: number }

// ── Constants ──────────────────────────────────────────────────────────────────

const FONT = 'var(--font-fredoka)'
const BROWN = 'var(--admin-brown-dark)'
const GOLD = 'var(--admin-gold)'
const CREAM = 'var(--admin-cream)'
const DIVIDER = 'var(--admin-divider)'
const INPUT_BORDER = 'var(--admin-input-border)'
const GREEN = 'var(--admin-success-green)'
const GREEN_HOVER = 'var(--admin-green-hover)'
const WHITE = 'var(--admin-white)'
const DISABLED_GRAY = 'var(--admin-disabled-gray)'
const ERROR_RED = 'var(--admin-error-red)'
const GREEN_LIGHT_BG = 'var(--admin-green-light-bg)'
const TAN_HOVER = 'var(--admin-tan-hover)'
const TAN_ACTIVE = 'var(--admin-tan-active)'
const MEDIUM_BROWN = 'var(--admin-brown-medium)'

const FSL_LETTERS = [
  'A','B','C','D','E','F','G','H','I','J','K','L','M',
  'N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
]

const OPTION_KEYS = ['A', 'B', 'C', 'D'] as const

const emptyLesson = (): Omit<Lesson, 'lesson_id'> => ({
  lesson_title: '', video_url: '', content_text: '', lesson_order: 1,
})

const emptyQuestion = (): Omit<Question, 'question_id'> => ({
  question_type: 'identify',
  question_text: '',
  video_url: '',
  option_a: '', option_b: '', option_c: '', option_d: '',
  correct_answer: 'A',
  target_sign: '', reference_data: '',
  correct_sign: '',
  points: 1,
})

const normalizeQuestion = (q: Partial<Question>): Question => ({
  question_id: q.question_id ?? '',
  question_type: q.question_type === 'perform' ? 'perform' : 'identify',
  question_text: q.question_text ?? '',
  video_url: q.video_url ?? '',
  option_a: q.option_a ?? '',
  option_b: q.option_b ?? '',
  option_c: q.option_c ?? '',
  option_d: q.option_d ?? '',
  correct_answer: q.correct_answer ?? 'A',
  target_sign: q.target_sign ?? '',
  reference_data: q.reference_data ?? '',
  correct_sign: q.correct_sign ?? '',
  points: typeof q.points === 'number' && Number.isFinite(q.points) ? q.points : 1,
})

const normalizeQuestionDraft = (
  q: QuestionDraft
): QuestionDraft => ({
  ...normalizeQuestion(q),
  question_id: q.question_id,
  insertAt: q.insertAt,
})

// ── Shared styles ──────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  fontFamily: FONT, color: BROWN, fontSize: '0.95rem',
  backgroundColor: WHITE, border: `1.5px solid ${INPUT_BORDER}`,
  borderRadius: '8px', padding: '8px 12px', outline: 'none', width: '100%',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  padding: '8px 32px 8px 12px', appearance: 'none', WebkitAppearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%235D3A1A' stroke-width='1.8' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', cursor: 'pointer',
}

const labelSt: React.CSSProperties = {
  fontFamily: FONT, color: BROWN, fontWeight: 700,
  fontSize: '0.9rem', marginBottom: '5px', display: 'block',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={labelSt}>{label}</label>
      {children}
    </div>
  )
}

function BtnPrimary({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: FONT, color: WHITE, fontSize: '0.95rem', fontWeight: 700,
        backgroundColor: disabled ? GREEN_HOVER : GREEN, border: 'none',
        borderRadius: '10px', padding: '8px 20px', cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.8 : 1,
      }}
    >
      {children}
    </button>
  )
}

function BtnSecondary({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: FONT, color: BROWN, fontSize: '0.95rem', fontWeight: 600,
        backgroundColor: WHITE, border: `1.5px solid ${INPUT_BORDER}`,
        borderRadius: '10px', padding: '8px 20px', cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

// ── Lesson Form ────────────────────────────────────────────────────────────────

function LessonForm({
  lesson, isNew, onSave, onCancel, onDelete,
}: {
  lesson: Omit<Lesson, 'lesson_id'> & { lesson_id?: string }
  isNew: boolean
  onSave: (l: Omit<Lesson, 'lesson_id'> & { lesson_id?: string }) => Promise<void>
  onCancel: () => void
  onDelete?: () => void
}) {
  const [form, setForm] = useState(lesson)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [videos, setVideos] = useState<string[]>([])
  const [loadingVideos, setLoadingVideos] = useState(true)

  useEffect(() => setForm(lesson), [lesson])

  useEffect(() => {
    const loadVideos = async () => {
      setLoadingVideos(true)
      try {
        console.log('[LessonForm] Loading videos...')
        const videoList = await listLessonVideos()
        console.log('[LessonForm] Got video list:', videoList)
        setVideos(videoList)
      } catch (err) {
        console.error('[LessonForm] Failed to load videos:', err)
        setVideos([])
      } finally {
        setLoadingVideos(false)
      }
    }
    loadVideos()
  }, [])

  const set = (k: string, v: string | number) => setForm(prev => ({ ...prev, [k]: v }))

  const handleVideoSelect = (selectedFilename: string) => {
    const fullUrl = getLessonVideoUrl(selectedFilename)
    set('video_url', fullUrl)
  }

  const handleSave = async () => {
    if (!form.lesson_title.trim()) { setError('Lesson title is required.'); return }
    setSaving(true); setError('')
    try { await onSave(form) } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save.')
    } finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto pr-1">
      <h2 style={{ fontFamily: FONT, color: BROWN, fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px' }}>
        {isNew ? 'Add New Lesson' : 'Edit Lesson'}
      </h2>

      <Field label="Lesson Title">
        <input
          type="text" value={form.lesson_title} style={inputStyle}
          onChange={e => set('lesson_title', e.target.value)}
          onFocus={e => (e.currentTarget.style.borderColor = '#B5621E')}
          onBlur={e => (e.currentTarget.style.borderColor = INPUT_BORDER)}
        />
      </Field>

      <Field label="Video URL">
        {loadingVideos ? (
          <div style={{ fontFamily: FONT, color: '#999', fontSize: '0.9rem', padding: '8px' }}>
            Loading videos...
          </div>
        ) : (
          <>
            <VideoSelect
              value={
                form.video_url
                  ? form.video_url.split('/').pop()?.replace(/\.(mp4|mp44|mov|webm|avi|mkv)$/i, '') || ''
                  : ''
              }
              onChange={handleVideoSelect}
              videos={videos}
              style={inputStyle}
            />
            {videos.length === 0 && !loadingVideos && (
              <p style={{ fontFamily: FONT, color: '#999', fontSize: '0.85rem', marginTop: '5px' }}>
                No videos found in storage. Please upload videos to the lessons-videos bucket first.
              </p>
            )}
          </>
        )}
      </Field>

      <Field label="Content / Notes">
        <textarea
          value={form.content_text} rows={4} style={{ ...inputStyle, resize: 'vertical' }}
          onChange={e => set('content_text', e.target.value)}
          onFocus={e => (e.currentTarget.style.borderColor = '#B5621E')}
          onBlur={e => (e.currentTarget.style.borderColor = INPUT_BORDER)}
        />
      </Field>

      <Field label="Lesson Order">
        <input
          type="number" value={form.lesson_order} min={1} style={{ ...inputStyle, width: '80px' }}
          onChange={e => set('lesson_order', parseInt(e.target.value) || 1)}
        />
      </Field>

      {error && <p style={{ fontFamily: FONT, color: ERROR_RED, fontSize: '0.88rem', marginBottom: '10px' }}>{error}</p>}

      <div className="flex items-center justify-between mt-auto">
        {!isNew && onDelete
          ? <button onClick={onDelete} style={{ fontFamily: FONT, color: ERROR_RED, fontSize: '0.88rem', background: 'none', border: 'none', cursor: 'pointer' }}>Delete lesson</button>
          : <span />}
        <div className="flex gap-3">
          <BtnSecondary onClick={onCancel}>Cancel</BtnSecondary>
          <BtnPrimary onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Lesson'}</BtnPrimary>
        </div>
      </div>
    </div>
  )
}

// ── Question Form ──────────────────────────────────────────────────────────────

function QuestionForm({
  question, mode, isNew, onSave, onCancel, onDelete, insertPosition, maxInsertPosition, onInsertPositionChange,
}: {
  question: QuestionDraft
  mode: 'practice' | 'assessment'
  isNew: boolean
  onSave: (q: QuestionDraft) => Promise<void>
  onCancel: () => void
  onDelete?: () => void
  insertPosition?: number
  maxInsertPosition?: number
  onInsertPositionChange?: (position: number) => void
}) {
  const [form, setForm] = useState<QuestionDraft>(
    normalizeQuestionDraft(question)
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [videos, setVideos] = useState<string[]>([])
  const [loadingVideos, setLoadingVideos] = useState(true)

  useEffect(() => setForm(normalizeQuestionDraft(question)), [question])

  useEffect(() => {
    const loadVideos = async () => {
      setLoadingVideos(true)
      try {
        console.log('[QuestionForm] Loading videos...')
        const videoList = await listLessonVideos()
        console.log('[QuestionForm] Got video list:', videoList)
        setVideos(videoList)
      } catch (err) {
        console.error('[QuestionForm] Failed to load videos:', err)
        setVideos([])
      } finally {
        setLoadingVideos(false)
      }
    }
    loadVideos()
  }, [])

  const set = (k: string, v: string | number) => setForm(prev => ({ ...prev, [k]: v }))

  const handleVideoSelect = (selectedFilename: string) => {
    const fullUrl = getLessonVideoUrl(selectedFilename)
    set('video_url', fullUrl)
  }

  const handleSave = async () => {
    if (!form.question_text.trim()) { setError('Question text is required.'); return }
    if (form.question_type === 'identify') {
      if (!form.video_url.trim()) { setError('Video URL is required for Identify type.'); return }
      if (!form.option_a || !form.option_b || !form.option_c || !form.option_d) {
        setError('All four options are required.'); return
      }
    } else {
      const signField = mode === 'practice' ? form.target_sign : form.correct_sign
      if (!signField.trim()) { setError(`${mode === 'practice' ? 'Target sign' : 'Correct sign'} is required.`); return }
    }

    const payload = isNew && typeof insertPosition === 'number'
      ? { ...form, insertAt: insertPosition }
      : form

    setSaving(true); setError('')
    try { await onSave(payload) } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save.')
    } finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto pr-1">
      <h2 style={{ fontFamily: FONT, color: BROWN, fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px' }}>
        {isNew ? 'Add New Question' : 'Edit Question'}
      </h2>

      {/* Question Type Toggle */}
      <Field label="Question Type">
        <div className="flex gap-2">
          {(['identify', 'perform'] as QuestionType[]).map(t => (
            <button
              key={t}
              onClick={() => set('question_type', t)}
              style={{
                fontFamily: FONT, fontSize: '0.9rem', fontWeight: 600,
                padding: '6px 18px', borderRadius: '8px', cursor: 'pointer',
                border: `1.5px solid ${form.question_type === t ? GREEN : INPUT_BORDER}`,
                backgroundColor: form.question_type === t ? GREEN_LIGHT_BG : WHITE,
                color: form.question_type === t ? GREEN : BROWN,
              }}
            >
              {t === 'identify' ? 'Identify (watch → pick)' : 'Perform (letter → sign)'}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Question Text">
        <input
          type="text" value={form.question_text} style={inputStyle}
          onChange={e => set('question_text', e.target.value)}
          onFocus={e => (e.currentTarget.style.borderColor = '#B5621E')}
          onBlur={e => (e.currentTarget.style.borderColor = INPUT_BORDER)}
        />
      </Field>

      {isNew && typeof insertPosition === 'number' && typeof maxInsertPosition === 'number' && onInsertPositionChange && (
        <Field label="Insert At Position">
          <input
            type="number"
            value={insertPosition}
            min={1}
            max={maxInsertPosition}
            style={{ ...inputStyle, width: '120px' }}
            onChange={e => {
              const raw = parseInt(e.target.value, 10)
              const safe = Number.isFinite(raw)
                ? Math.min(Math.max(raw, 1), maxInsertPosition)
                : maxInsertPosition
              onInsertPositionChange(safe)
            }}
          />
        </Field>
      )}

      {form.question_type === 'identify' ? (
        <>
          <Field label="Video URL (sign being shown)">
            {loadingVideos ? (
              <div style={{ fontFamily: FONT, color: DISABLED_GRAY, fontSize: '0.9rem', padding: '8px' }}>
                Loading videos...
              </div>
            ) : (
              <>
                <VideoSelect
                  value={
                    form.video_url
                      ? form.video_url.split('/').pop()?.replace(/\.(mp4|mp44|mov|webm|avi|mkv)$/i, '') || ''
                      : ''
                  }
                  onChange={handleVideoSelect}
                  videos={videos}
                  style={inputStyle}
                />
                {videos.length === 0 && !loadingVideos && (
                  <p style={{ fontFamily: FONT, color: DISABLED_GRAY, fontSize: '0.85rem', marginTop: '5px' }}>
                    No videos found in storage. Please upload videos to the lessons-videos bucket first.
                  </p>
                )}
              </>
            )}
          </Field>

          <div style={{ marginBottom: '14px' }}>
            <label style={labelSt}>Answer Options</label>
            <div className="grid grid-cols-2 gap-3">
              {OPTION_KEYS.map((opt, idx) => (
                <div key={opt}>
                  <label style={{ ...labelSt, fontWeight: 500, fontSize: '0.85rem' }}>Choice {idx + 1}</label>
                  <select
                    value={form[`option_${opt.toLowerCase()}` as keyof typeof form] as string}
                    onChange={e => set(`option_${opt.toLowerCase()}`, e.target.value)}
                    style={selectStyle}
                  >
                    <option value="">— select —</option>
                    {FSL_LETTERS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <Field label="Correct Answer">
            <div style={{ width: '50%' }}>
              <select value={form.correct_answer} onChange={e => set('correct_answer', e.target.value)} style={selectStyle}>
                {OPTION_KEYS.map((opt, idx) => (
                  <option key={opt} value={opt}>
                    {form[`option_${opt.toLowerCase()}` as keyof typeof form] || `Choice ${idx + 1}`}
                  </option>
                ))}
              </select>
            </div>
          </Field>
        </>
      ) : (
        <>
          {mode === 'practice' ? (
            <Field label="Target Sign (letter the user must sign)">
              <input
                type="text" value={form.target_sign} placeholder="e.g. A" style={{ ...inputStyle, width: '120px' }}
                onChange={e => set('target_sign', e.target.value.toUpperCase())}
              />
            </Field>
          ) : (
            <Field label="Correct Sign (letter the user must sign)">
              <input
                type="text" value={form.correct_sign} placeholder="e.g. A" style={{ ...inputStyle, width: '120px' }}
                onChange={e => set('correct_sign', e.target.value.toUpperCase())}
              />
            </Field>
          )}
        </>
      )}

      {mode === 'assessment' && (
        <Field label="Points">
          <input
            type="number" value={form.points} min={1} style={{ ...inputStyle, width: '80px' }}
            onChange={e => set('points', parseInt(e.target.value) || 1)}
          />
        </Field>
      )}

      {error && <p style={{ fontFamily: FONT, color: '#B91C1C', fontSize: '0.88rem', marginBottom: '10px' }}>{error}</p>}

      <div className="flex items-center justify-between mt-auto">
        {!isNew && onDelete
          ? <button onClick={onDelete} style={{ fontFamily: FONT, color: ERROR_RED, fontSize: '0.88rem', background: 'none', border: 'none', cursor: 'pointer' }}>Delete question</button>
          : <span />}
        <div className="flex gap-3">
          <BtnSecondary onClick={onCancel}>Cancel</BtnSecondary>
          <BtnPrimary onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Question'}</BtnPrimary>
        </div>
      </div>
    </div>
  )
}

function NewLevelModal({ onCreated, onClose }: { onCreated: (level: Level) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [order, setOrder] = useState(1)
  const [passingScore, setPassingScore] = useState(75)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    if (!name.trim()) { setError('Level name is required.'); return }
    setSaving(true)
    setError('')
    try {
      const res = await adminFetch('/api/admin/levels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level_name: name, sequence_order: order, passing_score: passingScore }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to create')
      onCreated(data.level)
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create level.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.45)', backdropFilter: 'blur(1px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="rounded-2xl p-6 w-full max-w-sm" style={{ backgroundColor: WHITE }}>
        <h2 style={{ fontFamily: FONT, color: BROWN, fontSize: '1.2rem', fontWeight: 700, marginBottom: '20px' }}>
          Create New Level
        </h2>

        <Field label="Level Name">
          <input
            type="text"
            value={name}
            placeholder="e.g. Level 1 — Alphabet Basics"
            style={inputStyle}
            autoFocus
            onChange={e => setName(e.target.value)}
            onFocus={e => (e.currentTarget.style.borderColor = MEDIUM_BROWN)}
            onBlur={e => (e.currentTarget.style.borderColor = INPUT_BORDER)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Order / Sequence">
            <input
              type="number"
              value={order}
              min={1}
              style={inputStyle}
              onChange={e => setOrder(parseInt(e.target.value) || 1)}
            />
          </Field>
          <Field label="Passing Score (%)">
            <input
              type="number"
              value={passingScore}
              min={1}
              max={100}
              style={inputStyle}
              onChange={e => setPassingScore(parseInt(e.target.value) || 75)}
            />
          </Field>
        </div>

        {error && <p style={{ fontFamily: FONT, color: ERROR_RED, fontSize: '0.88rem', marginBottom: '10px' }}>{error}</p>}

        <div className="flex justify-end gap-3 mt-2">
          <BtnSecondary onClick={onClose}>Cancel</BtnSecondary>
          <BtnPrimary onClick={handleCreate} disabled={saving}>{saving ? 'Creating…' : 'Create Level'}</BtnPrimary>
        </div>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AdminLevelsPage() {
  const [levels, setLevels] = useState<Level[]>([])
  const [selectedLevelId, setSelectedLevelId] = useState<string>('')
  const [activeTab, setActiveTab] = useState<Tab>('lessons')
  const [showNewLevel, setShowNewLevel] = useState(false)

  // Lessons state
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [loadingLessons, setLoadingLessons] = useState(false)
  const [selectedLessonIdx, setSelectedLessonIdx] = useState<number | null>(null)
  const [addingLesson, setAddingLesson] = useState(false)

  // Questions state
  const [questions, setQuestions] = useState<Question[]>([])
  const [loadingQuestions, setLoadingQuestions] = useState(false)
  const [selectedQIdx, setSelectedQIdx] = useState<number | null>(null)
  const [addingQuestion, setAddingQuestion] = useState(false)
  const [newQuestionInsertAt, setNewQuestionInsertAt] = useState(1)
  const [draggingQIdx, setDraggingQIdx] = useState<number | null>(null)
  const [reorderingQuestions, setReorderingQuestions] = useState(false)

  // Toast
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  // Load levels
  useEffect(() => {
    adminFetch('/api/admin/levels-list')
      .then(r => r.json())
      .then(d => {
        const lvls: Level[] = d.levels ?? []
        setLevels(lvls)
        if (lvls.length > 0) setSelectedLevelId(lvls[0].level_id)
      })
  }, [])

  // Load lessons when level or tab changes
  const loadLessons = useCallback(() => {
    if (!selectedLevelId || activeTab !== 'lessons') return
    setLoadingLessons(true)
    setSelectedLessonIdx(null)
    setAddingLesson(false)
    adminFetch(`/api/admin/lessons?levelId=${selectedLevelId}`)
      .then(r => r.json())
      .then(d => setLessons(d.lessons ?? []))
      .finally(() => setLoadingLessons(false))
  }, [selectedLevelId, activeTab])

  // Load questions when level or tab (practice/assessment) changes
  const loadQuestions = useCallback(() => {
    if (!selectedLevelId || activeTab === 'lessons') return
    setLoadingQuestions(true)
    setSelectedQIdx(null)
    setAddingQuestion(false)
    adminFetch(`/api/admin/questions?mode=${activeTab}&levelId=${selectedLevelId}`)
      .then(r => r.json())
      .then(d => setQuestions((d.questions ?? []).map((q: Partial<Question>) => normalizeQuestion(q))))
      .finally(() => setLoadingQuestions(false))
  }, [selectedLevelId, activeTab])

  useEffect(() => { loadLessons() }, [loadLessons])
  useEffect(() => { loadQuestions() }, [loadQuestions])
  useEffect(() => {
    setNewQuestionInsertAt(prev => Math.min(Math.max(prev, 1), questions.length + 1))
  }, [questions.length])

  // ── Lesson handlers ──────────────────────────────────────────────────────────

  const handleSaveLesson = async (form: Omit<Lesson, 'lesson_id'> & { lesson_id?: string }) => {
    if (form.lesson_id) {
      const res = await adminFetch('/api/admin/lessons', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: form.lesson_id, ...form }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to update')
      setLessons(prev => prev.map(l => l.lesson_id === form.lesson_id ? { ...l, ...form } as Lesson : l))
      showToast('Lesson updated.', true)
    } else {
      const res = await adminFetch('/api/admin/lessons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ levelId: selectedLevelId, ...form }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to create')
      setLessons(prev => [...prev, data.lesson])
      setAddingLesson(false)
      setSelectedLessonIdx(lessons.length)
      showToast('Lesson added.', true)
    }
  }

  const handleDeleteLesson = async (id: string) => {
    if (!window.confirm('Delete this lesson? This cannot be undone.')) return
    const res = await adminFetch(`/api/admin/lessons?id=${id}`, { method: 'DELETE' })
    if (!res.ok) { showToast('Failed to delete lesson.', false); return }
    setLessons(prev => prev.filter(l => l.lesson_id !== id))
    setSelectedLessonIdx(null)
    showToast('Lesson deleted.', true)
  }

  // ── Question handlers ────────────────────────────────────────────────────────

  const handleSaveQuestion = async (form: QuestionDraft) => {
    const mode = activeTab as 'practice' | 'assessment'
    if (form.question_id) {
      const res = await adminFetch('/api/admin/questions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, id: form.question_id, ...form }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to update')
      setQuestions(prev => prev.map(q => q.question_id === form.question_id ? normalizeQuestion({ ...q, ...form }) : q))
      showToast('Question updated.', true)
    } else {
      const targetInsertIndex = Math.min(
        Math.max((form.insertAt ?? questions.length + 1) - 1, 0),
        questions.length
      )

      const res = await fetch('/api/admin/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, levelId: selectedLevelId, ...form }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to create')
      setQuestions(prev => {
        const next = [...prev]
        next.splice(targetInsertIndex, 0, normalizeQuestion(data.question))
        return next
      })
      setAddingQuestion(false)
      setSelectedQIdx(targetInsertIndex)
      showToast('Question added.', true)
    }
  }

  const handleReorderQuestions = async (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || reorderingQuestions || !selectedLevelId) return

    const nextQuestions = [...questions]
    const [moved] = nextQuestions.splice(fromIdx, 1)
    nextQuestions.splice(toIdx, 0, moved)

    const previousQuestions = questions
    const previousSelected = selectedQIdx
    setQuestions(nextQuestions)

    if (selectedQIdx !== null) {
      if (selectedQIdx === fromIdx) {
        setSelectedQIdx(toIdx)
      } else if (fromIdx < selectedQIdx && toIdx >= selectedQIdx) {
        setSelectedQIdx(selectedQIdx - 1)
      } else if (fromIdx > selectedQIdx && toIdx <= selectedQIdx) {
        setSelectedQIdx(selectedQIdx + 1)
      }
    }

    setReorderingQuestions(true)
    try {
      const mode = activeTab as 'practice' | 'assessment'
      const res = await fetch('/api/admin/questions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, levelId: selectedLevelId, reorderIds: nextQuestions.map(q => q.question_id) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Failed to reorder questions')
      showToast('Questions reordered.', true)
    } catch (e) {
      setQuestions(previousQuestions)
      setSelectedQIdx(previousSelected)
      showToast(e instanceof Error ? e.message : 'Failed to reorder questions.', false)
    } finally {
      setReorderingQuestions(false)
      setDraggingQIdx(null)
    }
  }

  const handleDeleteQuestion = async (id: string) => {
    if (!window.confirm('Delete this question? This cannot be undone.')) return
    const res = await adminFetch(`/api/admin/questions?mode=${activeTab}&id=${id}`, { method: 'DELETE' })
    if (!res.ok) { showToast('Failed to delete question.', false); return }
    setQuestions(prev => prev.filter(q => q.question_id !== id))
    setSelectedQIdx(null)
    showToast('Question deleted.', true)
  }

  // ── Derived values ───────────────────────────────────────────────────────────

  const editingLesson = addingLesson ? emptyLesson() : selectedLessonIdx !== null ? lessons[selectedLessonIdx] : null
  const editingQuestion = addingQuestion ? emptyQuestion() : selectedQIdx !== null ? questions[selectedQIdx] : null
  const mode = activeTab as 'practice' | 'assessment'

  const tabs: { key: Tab; label: string }[] = [
    { key: 'lessons', label: 'Lessons' },
    { key: 'practice', label: 'Practice Questions' },
    { key: 'assessment', label: 'Assessment Questions' },
  ]

  return (
    <div className="flex flex-col gap-4 sm:gap-5 h-full min-h-0 overflow-y-auto lg:overflow-hidden">

      {/* Toast */}
      {toast && (
        <div
          className="fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg"
          style={{ fontFamily: FONT, color: WHITE, backgroundColor: toast.ok ? GREEN : ERROR_RED, fontSize: '0.97rem' }}
        >
          {toast.msg}
        </div>
      )}

      {/* New Level Modal */}
      {showNewLevel && (
        <NewLevelModal
          onCreated={level => {
            setLevels(prev => [...prev, level])
            setSelectedLevelId(level.level_id)
            setShowNewLevel(false)
            showToast('Level created.', true)
          }}
          onClose={() => setShowNewLevel(false)}
        />
      )}

      {/* ── Top bar: level selector + create button ──────────────────────── */}
      <div className="rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-end gap-4 shrink-0" style={{ backgroundColor: CREAM }}>
        <div style={{ flex: 1 }}>
          <label style={{ ...labelSt, marginBottom: '8px' }}>Select Level</label>
          {levels.length === 0 ? (
            <p style={{ fontFamily: FONT, color: GOLD, fontSize: '0.95rem' }}>No levels yet. Create one →</p>
          ) : (
            <select
              value={selectedLevelId}
              onChange={e => {
                setSelectedLevelId(e.target.value)
                setSelectedLessonIdx(null)
                setSelectedQIdx(null)
                setAddingLesson(false)
                setAddingQuestion(false)
              }}
              style={{ ...selectStyle, maxWidth: '360px' }}
            >
              {levels.map(l => (
                <option key={l.level_id} value={l.level_id}>{l.level_name}</option>
              ))}
            </select>
          )}
        </div>
        <BtnPrimary onClick={() => setShowNewLevel(true)}>+ New Level</BtnPrimary>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 rounded-xl p-1 shrink-0" style={{ backgroundColor: DIVIDER, width: 'fit-content' }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => {
              setActiveTab(t.key)
              setSelectedLessonIdx(null)
              setSelectedQIdx(null)
              setAddingLesson(false)
              setAddingQuestion(false)
            }}
            style={{
              fontFamily: FONT, fontSize: '0.95rem', fontWeight: 600,
              padding: '7px 20px', borderRadius: '9px', border: 'none', cursor: 'pointer',
              backgroundColor: activeTab === t.key ? WHITE : 'transparent',
              color: activeTab === t.key ? BROWN : GOLD,
              boxShadow: activeTab === t.key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Content: two-panel (list + form) ─────────────────────────────── */}
      {!selectedLevelId ? (
        <div className="flex-1 flex items-center justify-center">
          <p style={{ fontFamily: FONT, color: GOLD }}>Create or select a level above to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5 flex-1 min-h-0">

          {/* Left panel — list */}
          <div className="rounded-2xl p-4 sm:p-5 flex flex-col min-h-[22rem] xl:min-h-0 xl:h-full overflow-y-auto" style={{ backgroundColor: CREAM }}>
            {activeTab === 'lessons' && (
              <h2 style={{ fontFamily: FONT, color: GOLD, fontSize: '1.1rem', fontWeight: 700, textAlign: 'center', marginBottom: '14px' }}>
                Lesson List
              </h2>
            )}

            {/* List items */}
            {(activeTab === 'lessons' ? loadingLessons : loadingQuestions) ? (
              <div className="flex-1 flex items-center justify-center">
                <p style={{ fontFamily: FONT, color: GOLD }}>Loading…</p>
              </div>
            ) : activeTab === 'lessons' ? (
              lessons.length === 0 ? (
                <p style={{ fontFamily: FONT, color: GOLD, fontSize: '0.9rem', textAlign: 'center', marginTop: '20px' }}>No lessons yet.</p>
              ) : (
                <div className="flex flex-col gap-2 flex-1 overflow-y-auto">
                  {lessons.map((l, i) => {
                    const isActive = !addingLesson && selectedLessonIdx === i
                    return (
                      <button
                        key={l.lesson_id}
                        onClick={() => { setSelectedLessonIdx(i); setAddingLesson(false) }}
                        className="text-left w-full px-4 py-3 rounded-xl"
                        style={{ fontFamily: FONT, color: GOLD, fontWeight: 600, fontSize: '0.95rem', backgroundColor: isActive ? '#F4E0A0' : 'transparent', border: 'none', cursor: 'pointer' }}
                        onMouseEnter={e => { if (!isActive) (e.currentTarget).style.backgroundColor = '#FBF0CC' }}
                        onMouseLeave={e => { if (!isActive) (e.currentTarget).style.backgroundColor = 'transparent' }}
                      >
                        {i + 1}. {l.lesson_title || <em style={{ opacity: 0.6 }}>Untitled</em>}
                      </button>
                    )
                  })}
                </div>
              )
            ) : (
              questions.length === 0 ? (
                <p style={{ fontFamily: FONT, color: GOLD, fontSize: '0.9rem', textAlign: 'center', marginTop: '20px' }}>No questions yet.</p>
              ) : (
                <div className="flex flex-col gap-2 flex-1 overflow-y-auto">
                  <p style={{ fontFamily: FONT, color: GOLD, fontSize: '0.82rem', opacity: 0.75, marginBottom: '2px' }}>
                    Drag a question to reorder it.
                  </p>
                  {questions.map((q, i) => {
                    const isActive = !addingQuestion && selectedQIdx === i
                    const typeLabel = q.question_type === 'identify' ? '📺' : '✋'
                    const isDragging = draggingQIdx === i
                    return (
                      <button
                        key={q.question_id}
                        draggable
                        onClick={() => { setSelectedQIdx(i); setAddingQuestion(false) }}
                        onDragStart={() => setDraggingQIdx(i)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => {
                          e.preventDefault()
                          if (draggingQIdx === null) return
                          void handleReorderQuestions(draggingQIdx, i)
                        }}
                        onDragEnd={() => setDraggingQIdx(null)}
                        className="text-left w-full px-4 py-3 rounded-xl"
                        style={{
                          fontFamily: FONT,
                          color: GOLD,
                          fontWeight: 600,
                          fontSize: '0.95rem',
                          backgroundColor: isActive ? '#F4E0A0' : 'transparent',
                          border: 'none',
                          cursor: reorderingQuestions ? 'wait' : 'grab',
                          opacity: isDragging ? 0.65 : 1,
                        }}
                        onMouseEnter={e => { if (!isActive) (e.currentTarget).style.backgroundColor = '#FBF0CC' }}
                        onMouseLeave={e => { if (!isActive) (e.currentTarget).style.backgroundColor = 'transparent' }}
                      >
                        <span style={{ marginRight: '8px', opacity: 0.6 }}>⋮⋮</span>
                        {typeLabel} Q{i + 1}: {q.question_text || <em style={{ opacity: 0.6 }}>No text</em>}
                      </button>
                    )
                  })}
                </div>
              )
            )}

            {/* Add button */}
            <button
              onClick={() => {
                if (activeTab === 'lessons') { setAddingLesson(true); setSelectedLessonIdx(null) }
                else {
                  setAddingQuestion(true)
                  setSelectedQIdx(null)
                  setNewQuestionInsertAt(questions.length + 1)
                }
              }}
              className="mt-4 w-full py-2.5 rounded-xl font-bold"
              style={{ fontFamily: FONT, color: WHITE, backgroundColor: GREEN, border: 'none', cursor: 'pointer', fontSize: '0.95rem' }}
            >
              + Add {activeTab === 'lessons' ? 'Lesson' : 'Question'}
            </button>
          </div>

          {/* Right panel — edit form */}
          <div className="rounded-2xl p-4 sm:p-5 flex flex-col min-h-[22rem] xl:min-h-0 xl:h-full" style={{ backgroundColor: CREAM }}>
            {activeTab === 'lessons' ? (
              editingLesson ? (
                <LessonForm
                  key={addingLesson ? 'new-lesson' : lessons[selectedLessonIdx!]?.lesson_id}
                  lesson={addingLesson ? emptyLesson() : { ...lessons[selectedLessonIdx!] }}
                  isNew={addingLesson}
                  onSave={handleSaveLesson}
                  onCancel={() => { setAddingLesson(false); setSelectedLessonIdx(null) }}
                  onDelete={!addingLesson && selectedLessonIdx !== null
                    ? () => handleDeleteLesson(lessons[selectedLessonIdx!].lesson_id)
                    : undefined}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p style={{ fontFamily: FONT, color: GOLD, fontSize: '0.95rem', textAlign: 'center' }}>
                    Select a lesson or add a new one.
                  </p>
                </div>
              )
            ) : (
              editingQuestion ? (
                <QuestionForm
                  key={addingQuestion ? 'new-q' : questions[selectedQIdx!]?.question_id}
                  question={addingQuestion ? { ...emptyQuestion(), insertAt: newQuestionInsertAt } : { ...questions[selectedQIdx!] }}
                  mode={mode}
                  isNew={addingQuestion}
                  onSave={handleSaveQuestion}
                  onCancel={() => { setAddingQuestion(false); setSelectedQIdx(null) }}
                  insertPosition={newQuestionInsertAt}
                  maxInsertPosition={questions.length + (addingQuestion ? 1 : 0)}
                  onInsertPositionChange={setNewQuestionInsertAt}
                  onDelete={!addingQuestion && selectedQIdx !== null
                    ? () => handleDeleteQuestion(questions[selectedQIdx!].question_id)
                    : undefined}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p style={{ fontFamily: FONT, color: GOLD, fontSize: '0.95rem', textAlign: 'center' }}>
                    Select a question or add a new one.
                  </p>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}
