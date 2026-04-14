'use client'

import { useRef, useState } from 'react'
import { useLanguage } from '@/hooks/useLanguage'
import PracticeView from '@/components/module/PracticeView'
import IdentifyView from '@/components/module/IdentifyView'

export interface AssessmentQuestion {
  id: string
  levelId: string
  type: 'identify' | 'perform'
  questionText: string
  videoUrl: string | null
  optionA: string
  optionB: string
  optionC: string
  optionD: string
  correctAnswer: string
  correctSign: string
  points: number
}

export interface AssessmentCompletionSummary {
  scorePercent: number
  starsEarned: number
  isPassed: boolean
}

interface Props {
  levelNum: number
  levelLabel: string
  chapterId: string
  questions: AssessmentQuestion[]
  timerLabel?: string
  showTimer?: boolean
  onFinish: (summary: AssessmentCompletionSummary) => void
}

export default function AssessmentView({
  levelNum,
  levelLabel,
  chapterId,
  questions,
  timerLabel,
  showTimer = false,
  onFinish,
}: Props) {
  const { t } = useLanguage()
  const [currentIndex, setCurrentIndex] = useState(0)
  const performAccuracyRef = useRef<number | null>(null)
  const scoresRef = useRef<number[]>([])

  const current = questions[currentIndex]

  function normalizeAccuracy(value: number): number {
    if (!Number.isFinite(value)) return 0
    const normalized = value > 1 ? value / 100 : value
    return Math.max(0, Math.min(1, normalized))
  }

  function buildSummary(): AssessmentCompletionSummary {
    const answersCount = scoresRef.current.length
    const avg = answersCount > 0
      ? scoresRef.current.reduce((sum, value) => sum + value, 0) / answersCount
      : 0
    const scorePercent = Math.round(avg * 100)
    const starsEarned = scorePercent >= 80 ? 3 : scorePercent >= 60 ? 2 : scorePercent >= 40 ? 1 : 0

    return {
      scorePercent,
      starsEarned,
      isPassed: scorePercent >= 60,
    }
  }

  function finalizeSubmit() {
    onFinish(buildSummary())
  }

  function handleCompleteAssessment() {
    finalizeSubmit()
  }

  function handleNext(accuracy: number) {
    scoresRef.current.push(normalizeAccuracy(accuracy))
    performAccuracyRef.current = null
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1)
      return
    }
    handleCompleteAssessment()
  }

  if (!current) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-8 px-4 text-center">
        <h2 className="text-[#7B3F00] font-black text-2xl" style={{ fontFamily: 'var(--font-baloo)' }}>
          {t('assessmentPage.title')}
        </h2>
        <p className="text-[#7B3F00] font-semibold">{t('assessmentPage.noQuestionsForChapter')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-visible gap-1.5 sm:gap-2.5">
      <div className="text-center mb-0 shrink-0 -mt-2">
        <h2
          className="font-black leading-tight text-[2rem] sm:text-[2.35rem]"
          style={{ fontFamily: 'var(--font-spicy-rice)', color: '#E20A07' }}
        >
          {t('assessmentPage.title')}
        </h2>
        <p className="text-[#4A2C0A] font-bold text-base sm:text-lg mt-0">
          <span className="font-black">{t('lessonView.levelLabel').replace('{{number}}', String(levelNum))}</span>
          {'  '}
          <span className="font-semibold">{levelLabel}</span>
        </p>
      </div>

      <div className="shrink-0 flex items-center justify-center gap-3 sm:gap-4 -mt-0.5">
        <p className="text-center text-[#7B3F00] font-black text-sm sm:text-base">
          {t('identifyView.questionLabel')
            .replace('{{current}}', String(currentIndex + 1))
            .replace('{{total}}', String(questions.length))}
        </p>
        {showTimer && timerLabel && (
          <p className="text-[#7B3F00] font-black text-sm sm:text-base">{timerLabel}</p>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-visible pt-1 sm:pt-2">
        {current.type === 'perform' ? (
          <PracticeView
            key={current.id}
            letter={current.correctSign || current.questionText}
            letterIndex={currentIndex}
            totalLetters={questions.length}
            levelId={chapterId}
            showStarBar
            onResult={(accuracy) => {
              performAccuracyRef.current = accuracy
            }}
            onNext={() => handleNext(performAccuracyRef.current ?? 0)}
            questionText={current.questionText}
          />
        ) : (
          <IdentifyView
            key={current.id}
            questionText={current.questionText}
            videoUrl={current.videoUrl}
            optionA={current.optionA}
            optionB={current.optionB}
            optionC={current.optionC}
            optionD={current.optionD}
            correctAnswer={current.correctAnswer}
            questionIndex={currentIndex}
            totalQuestions={questions.length}
            sideBySide
            onNext={handleNext}
          />
        )}
      </div>
    </div>
  )
}
