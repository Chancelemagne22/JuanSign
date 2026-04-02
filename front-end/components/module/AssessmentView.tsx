'use client';

import { useState } from 'react';
import { useLanguage } from '@/hooks/useLanguage';

// COMPONENT: AssessmentView — TEMPLATE PLACEHOLDER
//
// Full implementation TODO:
//   - Fetch assessment_questions for this level from Supabase.
//   - Present each question to the user (webcam recording per question).
//   - Send each clip to Modal endpoint and receive { sign, confidence }.
//   - Score the attempt, calculate stars_earned (0–3) based on accuracy.
//   - INSERT result into `assessment_results` (score, stars_earned, time_taken_seconds, is_passed).
//   - INSERT feedback into `cnn_feedback` (accuracy_score, feedback_message).
//   - Show final score screen with stars and a "Back to Dashboard" button.
//   - On pass: update `user_progress` to unlock the next level.

interface Props {
  levelNum:   number;
  levelLabel: string;
  onFinish:   () => void;
  confirmSubmit?: boolean;
  reviewBeforeSubmit?: boolean;
}

export default function AssessmentView({
  levelNum,
  levelLabel,
  onFinish,
  confirmSubmit = true,
  reviewBeforeSubmit = true,
}: Props) {
  const { t } = useLanguage();
  const [showReviewPrompt, setShowReviewPrompt] = useState(false);

  function finalizeSubmit() {
    if (confirmSubmit && !window.confirm(t('assessmentView.submitConfirm'))) return;
    onFinish();
  }

  function handleFinishClick() {
    if (reviewBeforeSubmit) {
      setShowReviewPrompt(true);
      return;
    }
    finalizeSubmit();
  }

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-12 px-4 text-center">

      {showReviewPrompt && (
        <div
          className="fixed inset-0 z-40 bg-black/45 flex items-center justify-center px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowReviewPrompt(false);
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

      {/* Trophy icon placeholder */}
      <div className="w-24 h-24 rounded-full bg-[#F5C47A] border-[5px] border-[#F5C47A] flex items-center justify-center shadow-lg">
        <svg viewBox="0 0 24 24" className="w-12 h-12 text-[#7B3F00]" fill="currentColor" aria-hidden>
          <path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94A5.01 5.01 0 0 0 11 15.9V18H9v2h6v-2h-2v-2.1a5.01 5.01 0 0 0 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zm-2 3c0 1.65-1.35 3-3 3s-3-1.35-3-3V5h6v3zm-8 0c0 1.65-1.35 3-3 3S3 9.65 3 8V7h2v1zm8 0H7V7h10v1z" />
        </svg>
      </div>

      {/* Heading */}
      <div>
        <h2
          className="font-black text-[2rem] leading-tight"
          style={{
            fontFamily:       'var(--font-baloo)',
            color:            '#7B3F00',
            WebkitTextStroke: '1.5px #5D3A1A',
            textShadow:       '2px 2px 0 #5D3A1A',
          }}
        >
          {t('assessmentPage.title')}
        </h2>
        <p className="text-[#4A2C0A] font-bold text-base mt-1">
          <span className="font-black">{t('lessonView.levelLabel').replace('{{number}}', String(levelNum))}</span>{'  '}
          <span className="font-semibold">{levelLabel}</span>
        </p>
      </div>

      {/* Coming soon card */}
      <div className="w-full max-w-sm bg-[#FFF8EE] border-4 border-[#FFF8EE] rounded-[24px] px-8 py-8 shadow-md">
        <p className="text-[#7B3F00] font-black text-lg mb-2">{t('common.comingSoon')}</p>
        <p className="text-[#A86040] font-semibold text-sm leading-relaxed">
          {t('assessmentView.completedLetters')}
        </p>

        {/* Star row placeholder */}
        <div className="flex justify-center gap-3 mt-6 text-4xl">
          <span className="text-gray-300">★</span>
          <span className="text-gray-300">★</span>
          <span className="text-gray-300">★</span>
        </div>
      </div>

      {/* Back to Dashboard */}
      <button
        onClick={handleFinishClick}
        className="
          bg-[#2E8B2E] hover:bg-[#329932] text-white
          font-black uppercase tracking-widest text-base
          px-12 py-3 rounded-full
          shadow-[0_6px_0_#1a5c1a]
          active:translate-y-1 active:shadow-[0_2px_0_#1a5c1a]
          transition-all
        "
      >
        {t('assessmentView.backToDashboard')}
      </button>

    </div>
  );
}
