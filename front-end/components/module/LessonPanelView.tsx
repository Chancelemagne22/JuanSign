'use client';

// COMPONENT: LessonPanelView
// Displays a two-panel lesson layout with video on the left and context text on the right.
// Includes progress indicators, video controls, and level information.

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
}: {
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="
        w-10 h-10 rounded-full
        bg-[#33AA11] border-[3px] border-[#33AA11]
        flex items-center justify-center
        shadow-[0_3px_0_#165c00]
        active:translate-y-1 active:shadow-[0_1px_0_#165c00]
        transition-transform hover:brightness-110
        disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-[0_3px_0_#165c00]
      "
    >
      {children}
    </button>
  );
}

/* ── Progress indicator dot ────────────────────────────────────────────────── */
function ProgressDot({ isActive }: { isActive: boolean }) {
  return (
    <div
      className={`w-6 h-6 rounded-full border-[2px] flex items-center justify-center ${
        isActive
          ? 'bg-[#33AA11] border-[#33AA11]'
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

export default function LessonPanelView({
  letter,
  videoUrl,
  contextText,
  levelNum,
  levelLabel,
  currentIndex,
  totalLessons,
  onNext,
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
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* ── Main content area: Two panels (video left, context right) ────────── */}
      <div className="flex-1 min-h-0 flex gap-4">
        {/* Left panel: Video */}
        <div className="flex-[2] min-h-0 flex flex-col gap-2">
          {/* Video box */}
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <div
              className="relative w-full h-full rounded-[20px] border-[6px] border-[#8B5E3C] overflow-hidden bg-[#D4956A]"
            >
              {videoUrl && !videoError ? (
                <video
                  ref={videoRef}
                  src={videoUrl}
                  playsInline
                  preload="auto"
                  className="absolute inset-0 w-full h-full object-contain"
                  onError={() => setVideoError(true)}
                  onLoadedData={() => console.log('[LessonPanelView] video loaded:', videoUrl)}
                  onEnded={() => {
                    if (autoplayNext) onNext();
                  }}
                />
              ) : (
                /* Placeholder — shown when no videoUrl or when the URL fails to load */
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 select-none">
                  <span
                    className="font-black text-white/60 leading-none"
                    style={{ fontSize: 'clamp(3rem, 12vw, 8rem)' }}
                  >
                    {letter}
                  </span>
                  <p className="text-white/50 font-semibold text-sm">
                    {videoError ? t('lessonView.videoUnavailable') : t('lessonView.videoComingSoon')}
                  </p>
                </div>
              )}

              {/* ── Controls overlay (bottom-left inside the box) ───────────────── */}
              <div className="absolute bottom-3 left-3 flex gap-2 z-10">
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
            </div>
          </div>

          {/* Progress indicators below video */}
          <div className="flex gap-2 justify-center py-2 shrink-0">
            {Array.from({ length: totalLessons }).map((_, idx) => (
              <ProgressDot key={idx} isActive={idx === currentIndex} />
            ))}
          </div>
        </div>

        {/* Right panel: Context text */}
        <div className="flex-1 min-h-0 rounded-[20px] border-[6px] border-[#8B5E3C] bg-[#F5E6D3] p-4 overflow-y-auto">
          {contextText ? (
            <p className="text-[#4A2C0A] font-medium text-sm leading-relaxed whitespace-pre-wrap">
              {contextText}
            </p>
          ) : (
            <div className="flex items-center justify-center h-full text-[#7B3F00] text-center">
              <p className="font-semibold text-sm">{t('common.noContextAvailable') || 'Context coming soon...'}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom bar: Level info + Next button ────────────────────────────── */}
      <div className="grid grid-cols-3 items-center px-1 shrink-0 gap-2">
        {showCaptions ? (
          <p className="text-[#4A2C0A] text-sm sm:text-base justify-self-center text-center col-start-2">
            <span className="font-black">{t('lessonView.levelLabel').replace('{{number}}', String(levelNum))}</span>
            {'  '}
            <span className="font-semibold">{levelLabel}</span>
          </p>
        ) : (
          <div className="justify-self-center col-start-2" />
        )}

        {/* Next / Finish button */}
        <button
          onClick={onNext}
          aria-label={nextLabel ?? t('lessonView.nextAria')}
          className="
            justify-self-end col-start-3
            rounded-full px-4 h-10
            bg-[#33AA11] border-[3px] border-[#33AA11]
            flex items-center justify-center gap-2
            text-white font-black text-xs sm:text-sm
            shadow-[0_3px_0_#165c00]
            active:translate-y-1 active:shadow-[0_1px_0_#165c00]
            transition-transform hover:brightness-110
          "
        >
          {nextLabel ?? (
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
              <path d="M4 11h12.17l-5.59-5.59L12 4l8 8-8 8-1.41-1.41L16.17 13H4v-2z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
