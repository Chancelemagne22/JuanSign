'use client';

// COMPONENT: IdentifyView
// Shows a multiple-choice question (optional video + 4 options).
// Used by both Practice (no timer) and Assessment (timer passed from parent).

import { useRef, useState } from 'react';

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
  /** Called after the user confirms their answer; passes 1.0 if correct, 0.0 if wrong */
  onNext: (accuracy: number) => void;
  /** Enables side-by-side layout used on Practice chapter pages */
  sideBySide?: boolean;
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
        bg-[#33AA11] border-[3px] border-[#228800]
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
}: Props) {
  const options = { A: optionA, B: optionB, C: optionC, D: optionD };

  const [selected,  setSelected]  = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
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
      className={sideBySide ? 'w-full max-w-[1280px]' : 'w-full'}
      style={sideBySide ? { width: 'min(100%, calc((100vh - 320px) * 16 / 9))' } : undefined}
    >
      <div className="flex items-center justify-start gap-2.5">
        <VideoControlBtn onClick={playVideo} ariaLabel="Play">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        </VideoControlBtn>

        <VideoControlBtn onClick={pauseVideo} ariaLabel="Pause">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        </VideoControlBtn>

        <VideoControlBtn onClick={replayVideo} ariaLabel="Replay">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
          </svg>
        </VideoControlBtn>

        <VideoControlBtn onClick={stopVideo} ariaLabel="Stop">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
            <path d="M6 6h12v12H6z" />
          </svg>
        </VideoControlBtn>
      </div>
    </div>
  ) : null;

  function handleConfirm() {
    if (!selected || confirmed) return;
    setConfirmed(true);
  }

  function handleNext() {
    onNext(selected === correctAnswer ? 1.0 : 0.0);
  }

  const feedbackText = selected === correctAnswer
    ? '✓ Correct!'
    : `✗ Wrong — the answer is ${options[correctAnswer as keyof typeof options] || correctAnswer}`;

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
      Confirm
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
      {questionIndex < totalQuestions - 1 ? 'Next →' : 'Finish →'}
    </button>
  );

  const optionsGrid = (
    <div className="grid grid-cols-2 gap-3 px-1">
      {OPTION_KEYS.map((key) => {
        const showCorrect = confirmed && key === correctAnswer;
        const showWrong   = confirmed && selected === key && key !== correctAnswer;
        const isSelected  = selected === key && !confirmed;

        let bg   = 'bg-[#F5E6C8] border-[#BF7B45] text-[#5D3A1A]';
        if (showCorrect) bg = 'bg-green-500 border-green-700 text-white';
        else if (showWrong)  bg = 'bg-red-500   border-red-700   text-white';
        else if (isSelected) bg = 'bg-[#E8A87C] border-[#BF7B45] text-[#5D3A1A]';

        return (
          <button
            key={key}
            disabled={confirmed}
            onClick={() => setSelected(key)}
            className={`rounded-2xl border-[3px] px-5 py-3 font-bold text-sm text-center transition-all shadow-sm disabled:cursor-default ${bg}`}
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
      <div className="h-full min-h-0 flex flex-col gap-3 overflow-y-auto pb-2">
        <p className="text-center text-[#7B3F00] font-black text-base sm:text-lg">
          Question {questionIndex + 1} / {totalQuestions}
        </p>

        <div className="mx-auto w-full max-w-[1320px] grid min-h-0 flex-1 gap-3 lg:gap-4 lg:items-center lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
          <div className="min-w-0 flex flex-col items-center lg:items-end gap-3">
            <div
              className="relative w-full max-w-[1280px] aspect-video rounded-[24px] border-[6px] border-[#8B5E3C] overflow-hidden bg-[#D4956A]"
              style={{ width: 'min(100%, calc((100vh - 320px) * 16 / 9))' }}
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
                  <p className="text-white/70 font-black text-sm">Video coming soon</p>
                </div>
              )}
            </div>
            {customControls}
          </div>

          <div className="min-w-0 flex flex-col gap-4 lg:justify-center lg:justify-self-start lg:w-full lg:max-w-[560px]">
            <p
              className="text-center lg:text-left font-bold text-[1.15rem] sm:text-[1.25rem] text-[#4A2C0A] px-1"
              style={{ fontFamily: 'var(--font-fredoka)' }}
            >
              {questionText}
            </p>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 px-0">
              {OPTION_KEYS.map((key) => {
                const showCorrect = confirmed && key === correctAnswer;
                const showWrong   = confirmed && selected === key && key !== correctAnswer;
                const isSelected  = selected === key && !confirmed;

                let bg   = 'bg-[#F5E6C8] border-[#BF7B45] text-[#5D3A1A]';
                if (showCorrect) bg = 'bg-green-500 border-green-700 text-white';
                else if (showWrong)  bg = 'bg-red-500   border-red-700   text-white';
                else if (isSelected) bg = 'bg-[#E8A87C] border-[#BF7B45] text-[#5D3A1A]';

                return (
                  <button
                    key={key}
                    disabled={confirmed}
                    onClick={() => setSelected(key)}
                    className={`rounded-2xl border-[3px] px-5 py-3 font-bold text-sm text-center transition-all shadow-sm disabled:cursor-default ${bg}`}
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
            </div>

            <div className="flex justify-center lg:justify-end gap-3">
              {actionButton}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto pb-4">

      {/* ── Progress ──────────────────────────────────────────────── */}
      <p className="text-center text-[#7B3F00] font-black text-base sm:text-lg">
        Question {questionIndex + 1} / {totalQuestions}
      </p>

      {/* ── Video (if provided) ───────────────────────────────────── */}
      {videoUrl && (
        <>
          <div className="w-full rounded-[20px] overflow-hidden border-4 border-[#BF7B45] bg-black aspect-video">
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
        className="text-center font-bold text-[1.15rem] sm:text-[1.25rem] text-[#4A2C0A] px-2"
        style={{ fontFamily: 'var(--font-fredoka)' }}
      >
        {questionText}
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
      </div>

      {/* ── Action buttons ────────────────────────────────────────── */}
      <div className="flex justify-center gap-3 mt-auto">
        {actionButton}
      </div>

    </div>
  );
}
