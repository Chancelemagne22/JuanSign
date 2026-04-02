'use client';

// COMPONENT: LessonView
// Shows the demonstration video for a single letter/sign.
// Controls: Play, Pause, Restart (seek to 0 + play), Stop (pause + seek to 0).
// A "Next →" arrow button advances the user to the Practice step.

import { useEffect, useRef, useState } from 'react';

interface Props {
  letter:     string;
  videoUrl:   string | null;
  levelNum:   number;
  levelLabel: string;
  onNext:     () => void;
  autoplayNext?: boolean;
  playbackSpeed?: 0.75 | 1 | 1.25 | 1.5;
  showCaptions?: boolean;
  /** Override the next button label (e.g. "Finish ✓" on the last letter) */
  nextLabel?: string;
}

/* ── Green circular control button ─────────────────────────────────────────── */
function ControlBtn({
  onClick,
  disabled,
  ariaLabel,
  children,
}: {
  onClick:   () => void;
  disabled?: boolean;
  ariaLabel: string;
  children:  React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="
        w-11 h-11 rounded-full
        bg-[#33AA11] border-[3px] border-[#228800]
        flex items-center justify-center
        shadow-[0_4px_0_#165c00]
        active:translate-y-1 active:shadow-[0_1px_0_#165c00]
        transition-transform hover:brightness-110
        disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-[0_4px_0_#165c00]
      "
    >
      {children}
    </button>
  );
}

export default function LessonView({
  letter,
  videoUrl,
  levelNum,
  levelLabel,
  onNext,
  autoplayNext = false,
  playbackSpeed = 1,
  showCaptions = true,
  nextLabel,
}: Props) {
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

      {/* ── Video box ──────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div
          className="relative w-full max-w-[1280px] aspect-video rounded-[24px] border-[6px] border-[#8B5E3C] overflow-hidden bg-[#D4956A]"
          style={{ width: 'min(100%, calc((100vh - 280px) * 16 / 9))' }}
        >
          {videoUrl && !videoError ? (
            <video
              ref={videoRef}
              src={videoUrl}
              playsInline
              preload="auto"
              className="absolute inset-0 w-full h-full object-contain"
              onError={() => setVideoError(true)}
              onLoadedData={() => console.log('[LessonView] video loaded:', videoUrl)}
              onEnded={() => {
                if (autoplayNext) onNext();
              }}
            />
          ) : (
            /* Placeholder — shown when no videoUrl or when the URL fails to load */
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 select-none">
              <span
                className="font-black text-white/60 leading-none"
                style={{ fontSize: 'clamp(5rem, 18vw, 11rem)' }}
              >
                {letter}
              </span>
              <p className="text-white/50 font-semibold text-sm">
                {videoError ? 'Video unavailable' : 'Video coming soon'}
              </p>
            </div>
          )}

          {/* ── Controls overlay (bottom-left inside the box) ───────────────── */}
          <div className="absolute bottom-4 left-4 flex gap-2.5 z-10">
            <ControlBtn onClick={play} ariaLabel="Play">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            </ControlBtn>

            <ControlBtn onClick={pause} ariaLabel="Pause">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            </ControlBtn>

            <ControlBtn onClick={restart} ariaLabel="Restart">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
                <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
              </svg>
            </ControlBtn>

            <ControlBtn onClick={stop} ariaLabel="Stop">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
                <path d="M6 6h12v12H6z" />
              </svg>
            </ControlBtn>
          </div>
        </div>
      </div>

      {/* ── Below box: centered level label + next arrow (right) ────────────── */}
      <div className="grid grid-cols-3 items-center px-1 shrink-0">
        {showCaptions ? (
          <p className="text-[#4A2C0A] text-lg sm:text-xl justify-self-center text-center col-start-2">
            <span className="font-black">Level {levelNum}</span>
            {'  '}
            <span className="font-semibold">{levelLabel}</span>
          </p>
        ) : (
          <div className="justify-self-center col-start-2" />
        )}

        {/* Next / Finish button */}
        <button
          onClick={onNext}
          aria-label={nextLabel ?? 'Next'}
          className="
            justify-self-end col-start-3
            rounded-full px-5 h-12
            bg-[#33AA11] border-[3px] border-[#228800]
            flex items-center justify-center gap-2
            text-white font-black text-sm
            shadow-[0_4px_0_#165c00]
            active:translate-y-1 active:shadow-[0_1px_0_#165c00]
            transition-transform hover:brightness-110
          "
        >
          {nextLabel ?? (
            <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
              <path d="M4 11h12.17l-5.59-5.59L12 4l8 8-8 8-1.41-1.41L16.17 13H4v-2z" />
            </svg>
          )}
        </button>
      </div>

    </div>
  );
}
