'use client';

// COMPONENT: LessonView
// Shows the demonstration video for a single letter/sign.
// Controls: Play, Pause, Restart (seek to 0 + play), Stop (pause + seek to 0).
// A "Next →" arrow button advances the user to the Practice step.

import { useRef } from 'react';

interface Props {
  letter:     string;
  videoUrl:   string | null;
  levelNum:   number;
  levelLabel: string;
  onNext:     () => void;
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

export default function LessonView({ letter, videoUrl, levelNum, levelLabel, onNext }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  function play() {
    videoRef.current?.play();
  }

  function pause() {
    videoRef.current?.pause();
  }

  function restart() {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    v.play();
  }

  function stop() {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ── Video box ──────────────────────────────────────────────────────── */}
      <div
        className="relative w-full rounded-[24px] border-[6px] border-[#8B5E3C] overflow-hidden bg-[#D4956A]"
        style={{ aspectRatio: '16 / 10' }}
      >
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="absolute inset-0 w-full h-full object-contain"
          />
        ) : (
          /* Placeholder — replace once video assets are linked in Supabase */
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 select-none">
            <span
              className="font-black text-white/60 leading-none"
              style={{ fontSize: 'clamp(5rem, 18vw, 11rem)' }}
            >
              {letter}
            </span>
            <p className="text-white/50 font-semibold text-sm">Video coming soon</p>
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

      {/* ── Below box: level label (left) + next arrow (right) ─────────────── */}
      <div className="flex items-center justify-between px-1">
        <p className="text-[#4A2C0A] text-base">
          <span className="font-black">Level {levelNum}</span>
          {'  '}
          <span className="font-semibold">{levelLabel}</span>
        </p>

        {/* Next arrow — advances to Practice for this letter */}
        <button
          onClick={onNext}
          aria-label="Next: go to practice"
          className="
            w-12 h-12 rounded-full
            bg-[#33AA11] border-[3px] border-[#228800]
            flex items-center justify-center
            shadow-[0_4px_0_#165c00]
            active:translate-y-1 active:shadow-[0_1px_0_#165c00]
            transition-transform hover:brightness-110
          "
        >
          <svg viewBox="0 0 24 24" className="w-6 h-6 text-white" fill="currentColor" aria-hidden>
            <path d="M4 11h12.17l-5.59-5.59L12 4l8 8-8 8-1.41-1.41L16.17 13H4v-2z" />
          </svg>
        </button>
      </div>

    </div>
  );
}
