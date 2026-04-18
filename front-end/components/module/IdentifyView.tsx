'use client';

// COMPONENT: IdentifyView
// Shows a multiple-choice question (optional video + 4 options).
// Used by both Practice (no timer) and Assessment (timer passed from parent).

import { useRef, useState } from 'react';
import { useLanguage } from '@/hooks/useLanguage';

interface Props {
  questionText:   string;
  videoUrl:       string | null;
  optionA:        string;
  optionB:        string;
  optionC:        string;
  optionD:        string;
  correctAnswer:  string;           // 'A' | 'B' | 'C' | 'D'
  questionIndex:  number;
  totalQuestions: number;
  /**
   * Called when advancing to the next question.
   * Accuracy is 1.0 only when solved correctly on first try, otherwise 0.0.
   */
  onNext: (accuracy: number) => void;
  /** Enables side-by-side layout used on Practice chapter pages */
  sideBySide?: boolean;
  /** Controls whether feedback reveals the correct answer text when wrong */
  showCorrectAnswerAfterSubmit?: boolean;
  /** Enables simple success/failure tone feedback */
  soundEffects?: boolean;
}

const OPTION_KEYS = ['A', 'B', 'C', 'D'] as const;

function VideoControlBtn({
  onClick,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      className="
        w-11 h-11 rounded-full
        bg-[#33AA11] border-[3px] border-[#33AA11]
        flex items-center justify-center
        shadow-[0_4px_0_#165c00]
        active:translate-y-1 active:shadow-[0_1px_0_#165c00]
        transition-transform hover:brightness-110
      "
    >
      {children}
    </button>
  );
}

export default function IdentifyView({
  questionText,
  videoUrl,
  optionA, optionB, optionC, optionD,
  correctAnswer,
  questionIndex,
  totalQuestions,
  onNext,
  sideBySide = false,
  showCorrectAnswerAfterSubmit = true,
  soundEffects = true,
}: Props) {
  const { t } = useLanguage();
  const options = { A: optionA, B: optionB, C: optionC, D: optionD };
  const resolvedQuestionText =
    !questionText || questionText.trim().toLowerCase() === 'what sign is shown in the video?'
      ? t('identifyView.defaultQuestionPrompt')
      : questionText;

  const [selected,  setSelected]  = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [hasWrongAttempt, setHasWrongAttempt] = useState(false);
  const sideBySideVideoRef = useRef<HTMLVideoElement>(null);
  const stackedVideoRef = useRef<HTMLVideoElement>(null);

  function getVideoRef() {
    return sideBySide ? sideBySideVideoRef : stackedVideoRef;
  }

  function playVideo() {
    getVideoRef().current?.play().catch(() => {});
  }

  function pauseVideo() {
    getVideoRef().current?.pause();
  }

  function replayVideo() {
    const v = getVideoRef().current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {});
  }

  function stopVideo() {
    const v = getVideoRef().current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
  }

  const customControls = videoUrl ? (
    <div
      className={sideBySide ? 'w-full max-w-full' : 'w-full'}
      style={sideBySide ? { width: 'min(100%, 80rem, calc((100dvh - 20rem) * 16 / 9))' } : undefined}
    >
      <div className="flex items-center justify-start gap-2.5 flex-wrap">
        <VideoControlBtn onClick={playVideo} ariaLabel={t('lessonView.play')}>
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        </VideoControlBtn>

        <VideoControlBtn onClick={pauseVideo} ariaLabel={t('lessonView.pause')}>
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        </VideoControlBtn>

        <VideoControlBtn onClick={replayVideo} ariaLabel={t('identifyView.replay')}>
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
          </svg>
        </VideoControlBtn>

        <VideoControlBtn onClick={stopVideo} ariaLabel={t('lessonView.stop')}>
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
            <path d="M6 6h12v12H6z" />
          </svg>
        </VideoControlBtn>
      </div>
    </div>
  ) : null;

  function handleConfirm() {
    if (!selected || confirmed) return;

    const isCorrect = selected === correctAnswer;

    if (soundEffects) {
      playFeedbackTone(isCorrect);
    }

    if (!isCorrect) {
      setHasWrongAttempt(true);
    }

    setConfirmed(true);
  }

  function handleRetry() {
    setConfirmed(false);
    setSelected(null);
  }

  function handleNext() {
    const solvedOnFirstTry = selected === correctAnswer && !hasWrongAttempt;
    onNext(solvedOnFirstTry ? 1.0 : 0.0);
  }

  const isCorrectSelection = selected === correctAnswer;

  const feedbackText = selected === correctAnswer
    ? `✓ ${t('identifyView.correct')}`
    : showCorrectAnswerAfterSubmit
      ? `✗ ${t('identifyView.wrongWithAnswer').replace('{{answer}}', options[correctAnswer as keyof typeof options] || correctAnswer)}`
      : `✗ ${t('identifyView.wrong')}`;

  function playFeedbackTone(isCorrect: boolean) {
    try {
      const audioCtx = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.value = isCorrect ? 720 : 320;
      gain.gain.value = 0.05;

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
      setTimeout(() => void audioCtx.close(), 250);
    } catch {
      // Ignore sound errors silently to avoid breaking quiz flow.
    }
  }

  const actionButton = !confirmed ? (
    <button
      onClick={handleConfirm}
      disabled={!selected}
      className="
        bg-[#2E8B2E] hover:bg-[#329932] text-white font-black
        px-10 py-3 rounded-full shadow-[0_5px_0_#1a5c1a]
        transition-all disabled:opacity-40 disabled:cursor-not-allowed
      "
      style={{ fontFamily: 'var(--font-fredoka)' }}
    >
      {t('identifyView.confirm')}
    </button>
  ) : !isCorrectSelection ? (
    <button
      onClick={handleRetry}
      className="
        bg-[#FF9900] hover:bg-[#FFAD33] text-white font-black
        px-10 py-3 rounded-full shadow-[0_5px_0_#b86a00]
        active:translate-y-1 active:shadow-[0_1px_0_#b86a00]
        transition-all
      "
      style={{ fontFamily: 'var(--font-fredoka)' }}
    >
      {t('module.tryAgain')}
    </button>
  ) : (
    <button
      onClick={handleNext}
      className="
        bg-[#2E8B2E] hover:bg-[#329932] text-white font-black
        px-10 py-3 rounded-full shadow-[0_5px_0_#1a5c1a]
        active:translate-y-1 active:shadow-[0_1px_0_#1a5c1a]
        transition-all
      "
      style={{ fontFamily: 'var(--font-fredoka)' }}
    >
      {questionIndex < totalQuestions - 1 ? t('identifyView.nextArrow') : t('identifyView.finish')}
    </button>
  );

  const optionsGrid = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-1">
      {OPTION_KEYS.map((key) => {
        const showCorrect = confirmed && key === correctAnswer;
        const showWrong   = confirmed && selected === key && key !== correctAnswer;
        const isSelected  = selected === key && !confirmed;

        let bg   = 'bg-[#F5E6C8] border-[#F5E6C8] text-[#5D3A1A]';
        if (showCorrect) bg = 'bg-green-500 border-green-500 text-white';
        else if (showWrong)  bg = 'bg-red-500   border-red-500   text-white';
        else if (isSelected) bg = 'bg-[#E8A87C] border-[#E8A87C] text-[#5D3A1A]';

        return (
          <button
            key={key}
            disabled={confirmed}
            onClick={() => setSelected(key)}
              className={`rounded-2xl border-[3px] px-4 sm:px-5 py-3 font-bold text-sm text-center transition-all shadow-sm disabled:cursor-default min-w-0 ${bg}`}
            style={{ fontFamily: 'var(--font-fredoka)' }}
          >
            {options[key]}
          </button>
        );
      })}
    </div>
  );

  if (sideBySide) {
    return (
      <div className="h-full min-h-0 flex flex-col gap-3 overflow-y-auto overflow-x-hidden pb-2 min-w-0" style={{ WebkitOverflowScrolling: 'touch' }}>
        <p className="text-center text-[#7B3F00] font-black text-base sm:text-lg">
          {t('identifyView.questionLabel')
            .replace('{{current}}', String(questionIndex + 1))
            .replace('{{total}}', String(totalQuestions))}
        </p>

        <div className="mx-auto w-full max-w-[1320px] grid min-h-0 flex-1 gap-3 sm:gap-4 xl:grid-cols-2">
          <div className="min-w-0 rounded-2xl border-2 border-transparent bg-transparent p-3 sm:p-4 shadow-none flex flex-col gap-3">
            <div
              className="relative w-full rounded-[20px] sm:rounded-[24px] border-[4px] sm:border-[6px] border-[#8B5E3C] overflow-hidden bg-[#D4956A] aspect-video lg:h-[280px]"
            >
              {videoUrl ? (
                <video
                  ref={sideBySideVideoRef}
                  src={videoUrl}
                  playsInline
                  preload="metadata"
                  disablePictureInPicture
                  controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
                  className="absolute inset-0 w-full h-full object-contain"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <p className="text-white/70 font-black text-sm">{t('identifyView.videoComingSoon')}</p>
                </div>
              )}
            </div>
            <div className="min-h-[3rem]">{customControls}</div>
          </div>

          <div className="min-w-0 rounded-2xl border-2 border-transparent bg-transparent p-3 sm:p-4 shadow-none h-auto lg:min-h-[280px] overflow-visible flex flex-col gap-3">
            <p
              className="text-center xl:text-left font-bold text-[1.05rem] sm:text-[1.15rem] lg:text-[1.25rem] text-[#4A2C0A] px-1 break-words"
              style={{ fontFamily: 'var(--font-fredoka)' }}
            >
              {resolvedQuestionText}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-0">
              {OPTION_KEYS.map((key) => {
                const showCorrect = confirmed && key === correctAnswer;
                const showWrong   = confirmed && selected === key && key !== correctAnswer;
                const isSelected  = selected === key && !confirmed;

                let bg   = 'bg-[#F5E6C8] border-[#F5E6C8] text-[#5D3A1A]';
                if (showCorrect) bg = 'bg-green-500 border-green-500 text-white';
                else if (showWrong)  bg = 'bg-red-500   border-red-500   text-white';
                else if (isSelected) bg = 'bg-[#E8A87C] border-[#E8A87C] text-[#5D3A1A]';

                return (
                  <button
                    key={key}
                    disabled={confirmed}
                    onClick={() => setSelected(key)}
                    className={`rounded-2xl border-[3px] px-4 sm:px-5 py-3 font-bold text-sm text-center transition-all shadow-sm disabled:cursor-default min-w-0 ${bg}`}
                    style={{ fontFamily: 'var(--font-fredoka)' }}
                  >
                    {options[key]}
                  </button>
                );
              })}
            </div>

            <div className="min-h-[1.5rem]">
              <p
                className={`text-center lg:text-left font-black text-sm transition-opacity ${confirmed ? 'opacity-100' : 'opacity-0'} ${selected === correctAnswer ? 'text-green-600' : 'text-red-600'}`}
                style={{ fontFamily: 'var(--font-fredoka)' }}
              >
                {confirmed ? feedbackText : '\u00A0'}
              </p>
              {confirmed && !isCorrectSelection && (
                <p
                  className="mt-1 text-center lg:text-left text-[0.75rem] font-semibold text-amber-700"
                  style={{ fontFamily: 'var(--font-fredoka)' }}
                >
                  {t('identifyView.retryScoringNotice')}
                </p>
              )}
            </div>

            <div className="flex justify-center xl:justify-end gap-3 mt-auto">
              {actionButton}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto overflow-x-hidden pb-4 min-w-0" style={{ WebkitOverflowScrolling: 'touch' }}>

      {/* ── Progress ──────────────────────────────────────────────── */}
      <p className="text-center text-[#7B3F00] font-black text-base sm:text-lg">
        Question {questionIndex + 1} / {totalQuestions}
      </p>

      {/* ── Video (if provided) ───────────────────────────────────── */}
      {videoUrl && (
        <>
          <div className="w-full rounded-[20px] overflow-hidden border-4 border-[#BF7B45] bg-black aspect-video min-w-0">
            <video
              ref={stackedVideoRef}
              src={videoUrl}
              playsInline
              preload="metadata"
              disablePictureInPicture
              controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
              className="w-full h-full object-contain"
            />
          </div>
          {customControls}
        </>
      )}

      {/* ── Question text ─────────────────────────────────────────── */}
      <p
        className="text-center font-bold text-[1.05rem] sm:text-[1.15rem] lg:text-[1.25rem] text-[#4A2C0A] px-2 break-words"
        style={{ fontFamily: 'var(--font-fredoka)' }}
      >
        {resolvedQuestionText}
      </p>

      {/* ── Options ───────────────────────────────────────────────── */}
      {optionsGrid}

      {/* ── Feedback ──────────────────────────────────────────────── */}
      <div className="min-h-[1.5rem]">
        <p
          className={`text-center font-black text-sm transition-opacity ${confirmed ? 'opacity-100' : 'opacity-0'} ${selected === correctAnswer ? 'text-green-600' : 'text-red-600'}`}
          style={{ fontFamily: 'var(--font-fredoka)' }}
        >
          {confirmed ? feedbackText : '\u00A0'}
        </p>
        {confirmed && !isCorrectSelection && (
          <p
            className="mt-1 text-center text-[0.75rem] font-semibold text-amber-700"
            style={{ fontFamily: 'var(--font-fredoka)' }}
          >
            {t('identifyView.retryScoringNotice')}
          </p>
        )}
      </div>

      {/* ── Action buttons ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row justify-center gap-3 mt-auto">
        {actionButton}
      </div>

    </div>
  );
}
