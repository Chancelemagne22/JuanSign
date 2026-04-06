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

interface Props {
  levelNum: number
  levelLabel: string
  chapterId: string
  questions: AssessmentQuestion[]
  timerLabel?: string
  showTimer?: boolean
  onFinish: () => void
  confirmSubmit?: boolean
  reviewBeforeSubmit?: boolean
}

export default function AssessmentView({
  levelNum,
  levelLabel,
  chapterId,
  questions,
  timerLabel,
  showTimer = false,
  onFinish,
  confirmSubmit = true,
  reviewBeforeSubmit = true,
}: Props) {
  const { t } = useLanguage()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showReviewPrompt, setShowReviewPrompt] = useState(false)
  const performAccuracyRef = useRef<number | null>(null)

  const current = questions[currentIndex]

  function finalizeSubmit() {
    if (confirmSubmit && !window.confirm(t('assessmentView.submitConfirm'))) return
    onFinish()
  }

  function handleCompleteAssessment() {
    if (reviewBeforeSubmit) {
      setShowReviewPrompt(true)
      return
    }
    finalizeSubmit()
  }

  function handleNext(accuracy: number) {
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
    <div className="flex flex-col h-full min-h-0 overflow-hidden gap-1.5 sm:gap-2.5">
      {showReviewPrompt && (
        <div
          className="fixed inset-0 z-40 bg-black/45 flex items-center justify-center px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowReviewPrompt(false)
          }}
        >
          <div className="w-full max-w-md rounded-2xl border-4 border-[#BF7B45] bg-white p-5 text-left">
            <p className="text-[#7B3F00] font-black text-lg mb-2">{t('assessmentView.reviewBeforeSubmitTitle')}</p>
            <p className="text-[#5D3A1A] font-semibold text-sm leading-relaxed">
              {t('assessmentView.reviewBeforeSubmitBody')}
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setShowReviewPrompt(false)}
                className="px-4 py-2 rounded-xl border-2 border-[#BF7B45] text-[#7B3F00] font-bold"
              >
                {t('common.goBack')}
              </button>
              <button
                onClick={finalizeSubmit}
                className="px-4 py-2 rounded-xl bg-[#2E8B2E] text-white font-black"
              >
                {t('assessmentView.submit')}
              </button>
            </div>
          </div>
        </div>
      )}

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

      <div className="flex-1 min-h-0 overflow-hidden pt-6 sm:pt-7">
        {current.type === 'perform' ? (
          <PracticeView
            key={current.id}
            letter={current.correctSign || current.questionText}
            letterIndex={currentIndex}
            totalLetters={questions.length}
            levelId={chapterId}
            onResult={(accuracy) => {
              performAccuracyRef.current = accuracy
            }}
            onNext={() => handleNext(performAccuracyRef.current ?? 0)}
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
