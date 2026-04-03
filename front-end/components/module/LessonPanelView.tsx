'use client';

// COMPONENT: LessonPanelView
// Displays a unified lesson layout with video and context text as one cohesive learning unit.
// Video: unobstructed display with controls below (not overlay)
// Instructions: structured steps with visual hierarchy
// Responsive: single column on mobile, two-column on desktop

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/hooks/useLanguage';

interface Props {
  letter: string;
  videoUrl: string | null;
  contextText: string | null;
  levelNum: number;
  levelLabel: string;
  currentIndex: number;
  totalLessons: number;
  onNext: () => void;
  onPrevious?: () => void;
  autoplayNext?: boolean;
  playbackSpeed?: 0.75 | 1 | 1.25 | 1.5;
  showCaptions?: boolean;
  nextLabel?: string;
}

/* ── Green circular control button ─────────────────────────────────────────── */
function ControlBtn({
  onClick,
  disabled,
  ariaLabel,
  children,
  size = 'normal',
}: {
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  children: React.ReactNode;
  size?: 'normal' | 'large';
}) {
  const sizeClass = size === 'large' ? 'w-12 h-12' : 'w-10 h-10';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`
        ${sizeClass} rounded-full
        bg-[#33AA11] border-[3px] border-[#33AA11]
        flex items-center justify-center
        shadow-[0_3px_0_#165c00]
        active:translate-y-1 active:shadow-[0_1px_0_#165c00]
        transition-transform hover:brightness-110
        disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-[0_3px_0_#165c00]
      `}
    >
      {children}
    </button>
  );
}

/* ── Progress indicator dot ────────────────────────────────────────────────── */
function ProgressDot({ isActive }: { isActive: boolean }) {
  return (
    <div
      className={`w-6 h-6 rounded-full border-[2px] flex items-center justify-center transition-all ${
        isActive
          ? 'bg-[#33AA11] border-[#33AA11] scale-110'
          : 'bg-white border-[#33AA11]'
      }`}
    >
      {isActive && (
        <svg viewBox="0 0 24 24" className="w-4 h-4 text-white" fill="currentColor" aria-hidden>
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
        </svg>
      )}
    </div>
  );
}

/* ── Instruction Steps Parser ────────────────────────────────────────────── */
function InstructionSteps({ text }: { text: string }) {
  // Split by newlines and filter empty lines
  const lines = text.split('\n').filter(line => line.trim());
  
  // Detect if text contains bullet points or numbers
  const hasBullets = lines.some(line => /^[\s]*[•\-\*]/.test(line));
  const hasNumbers = lines.some(line => /^[\s]*\d+[\.\)]/.test(line));
  
  // Clean up bullet points and numbers for display
  const cleanedLines = lines.map(line => {
    return line.replace(/^[\s]*[•\-\*\d+\.\)]\s*/, '');
  });

  return (
    <div className="space-y-3 max-w-[65ch]">
      {cleanedLines.map((line, idx) => (
        <div key={idx} className="flex gap-3 text-[#4A2C0A] text-base lg:text-lg leading-relaxed">
          <p className="font-medium">{line}</p>
        </div>
      ))}
    </div>
  );
}

export default function LessonPanelView({
  letter,
  videoUrl,
  contextText,
  levelNum,
  levelLabel,
  currentIndex,
  totalLessons,
  onNext,
  onPrevious,
  autoplayNext = false,
  playbackSpeed = 1,
  showCaptions = true,
  nextLabel,
}: Props) {
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoError, setVideoError] = useState(false);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed, videoUrl]);

  function play() {
    videoRef.current?.play().catch(() => {});
  }

  function pause() {
    videoRef.current?.pause();
  }

  function restart() {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {});
  }

  function stop() {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 lg:gap-6">
      {/* ═══════════════════════════════════════════════════════════════════════
        MAIN LEARNING CARD: Video + Instructions as unified unit
        ═══════════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 lg:gap-6">
        
        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          LEFT SECTION: VIDEO DISPLAY (unobstructed, controls below)
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        <div className="flex-1 lg:flex-[1.15] min-h-0 flex flex-col gap-3">
          
          {/* VIDEO CONTAINER - Clean, unobstructed */}
          <div className="flex-1 min-h-[320px] w-full max-w-[54rem] mx-auto flex items-center justify-center bg-gradient-to-b from-[#D4956A] to-[#C8845E] rounded-[12px] border-[3px] border-[#8B5E3C] overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
            {videoUrl && !videoError ? (
              <video
                ref={videoRef}
                src={videoUrl}
                playsInline
                controls={false}
                preload="auto"
                className="w-full h-full object-contain"
                onError={() => setVideoError(true)}
                onLoadedData={() => console.log('[LessonPanelView] video loaded:', videoUrl)}
                onEnded={() => {
                  if (autoplayNext) onNext();
                }}
              />
            ) : (
              /* Placeholder — shown when no videoUrl or when the URL fails to load */
              <div className="flex flex-col items-center justify-center gap-3 select-none">
                <span
                  className="font-black text-white/40 leading-none"
                  style={{ fontSize: 'clamp(2.5rem, 10vw, 5rem)' }}
                >
                  {letter}
                </span>
                <p className="text-white/40 font-semibold text-sm text-center px-4">
                  {videoError ? t('lessonView.videoUnavailable') : t('lessonView.videoComingSoon')}
                </p>
              </div>
            )}
          </div>

          {/* CONTROLS BAR - Below video (external, not overlay) */}
          <div className="flex gap-3 justify-center shrink-0">
            <ControlBtn onClick={play} ariaLabel={t('lessonView.play')}>
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-white" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            </ControlBtn>

            <ControlBtn onClick={pause} ariaLabel={t('lessonView.pause')}>
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-white" fill="currentColor" aria-hidden>
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            </ControlBtn>

            <ControlBtn onClick={restart} ariaLabel={t('lessonView.restart')}>
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-white" fill="currentColor" aria-hidden>
                <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
              </svg>
            </ControlBtn>

            <ControlBtn onClick={stop} ariaLabel={t('lessonView.stop')}>
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-white" fill="currentColor" aria-hidden>
                <path d="M6 6h12v12H6z" />
              </svg>
            </ControlBtn>
          </div>

          {/* PROGRESS INDICATORS - Below controls */}
          <div className="flex gap-2 justify-center py-1 shrink-0">
            {Array.from({ length: totalLessons }).map((_, idx) => (
              <ProgressDot key={idx} isActive={idx === currentIndex} />
            ))}
          </div>

          {/* LEVEL INFO - Below progress dots */}
          {showCaptions && (
            <div className="text-[#4A2C0A] text-sm sm:text-base lg:text-lg text-center shrink-0">
              <span className="font-black">{t('lessonView.levelLabel').replace('{{number}}', String(levelNum))}</span>
              <span className="hidden sm:inline"> • </span>
              <span className="font-semibold block sm:inline">{levelLabel}</span>
            </div>
          )}
        </div>

        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          RIGHT SECTION: INSTRUCTIONS (structured, readable)
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        <div className="flex-1 lg:flex-[1] min-h-0 flex flex-col rounded-[12px] border-[3px] border-[#8B5E3C] bg-[#F5E6D3] p-4 lg:p-5 overflow-y-auto shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
          
          {contextText ? (
            <>
              {/* SECTION TITLE */}
              <h3 className="text-[#4A2C0A] font-black text-base lg:text-lg mb-4 flex-shrink-0">
                {t('lessonView.instructions')}
              </h3>

              {/* INSTRUCTIONS CONTENT - Parsed steps with structure */}
              <div className="flex-1 min-h-0 overflow-y-auto mb-4">
                <InstructionSteps text={contextText} />
              </div>

              {/* TIPS/FOCUS CALLOUT */}
              <div className="mt-4 pt-4 border-t-2 border-[#D4C4B0] flex-shrink-0">
                <p className="text-[#4A2C0A] font-medium text-sm leading-relaxed">
                  <span className="font-black text-base">💡 </span>
                  <span className="font-black">Tip:</span> Watch carefully for hand positioning and movement
                </p>
              </div>
            </>
          ) : (
            /* EMPTY STATE - Helpful messaging */
            <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
              <div className="text-5xl mb-3 opacity-40">📝</div>
              <p className="text-[#7B3F00] font-semibold text-sm mb-1">
                {t('common.noContextAvailable')}
              </p>
              <p className="text-[#9B6F30] font-medium text-xs">
                Step-by-step instructions coming soon
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
        FOOTER ACTION BAR: Back/Next buttons
        ═══════════════════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-end px-2 shrink-0 gap-3">
        {/* Back / Next buttons container */}
        <div className="flex items-center justify-end gap-3 flex-shrink-0">
          {/* Back button */}
          <button
            onClick={() => onPrevious?.()}
            disabled={currentIndex === 0}
            aria-label={t('lessonView.previousAria') ?? 'Previous'}
            className="
              rounded-full px-5 h-10 flex-shrink-0
              bg-[#FF9900] border-[3px] border-[#FF9900]
              flex items-center justify-center gap-2
              text-white font-black text-xs sm:text-sm
              shadow-[0_3px_0_#b86a00]
              active:translate-y-1 active:shadow-[0_1px_0_#b86a00]
              transition-transform hover:brightness-110
              disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-[0_3px_0_#b86a00]
            "
          >
            <span>Back</span>
          </button>

          {/* Next / Finish button */}
          <button
            onClick={onNext}
            aria-label={nextLabel ?? t('lessonView.nextAria')}
            className="
              rounded-full px-5 h-10 flex-shrink-0
              bg-[#33AA11] border-[3px] border-[#33AA11]
              flex items-center justify-center gap-2
              text-white font-black text-xs sm:text-sm
              shadow-[0_3px_0_#165c00]
              active:translate-y-1 active:shadow-[0_1px_0_#165c00]
              transition-transform hover:brightness-110
            "
          >
            {nextLabel ? nextLabel : <span>Next</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
