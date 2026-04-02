'use client';

// ── ChapterTemplate ────────────────────────────────────────────────────────────
// Reusable lesson-content template. All visual "slots" are clearly labelled so
// art assets, backgrounds, and character images can be swapped in later without
// restructuring the layout.
//
// Slot guide:
//   backgroundSrc — full-bleed page background (default: plain white)
//   characterSrc  — decorative character / mascot beside the content card
//   videoUrl      — lesson demonstration video
//   content       — plain-text lesson body (whitespace preserved)
//   onPractice    — callback wired to the Practice button
//   onQuiz        — callback wired to the Quiz button
// ─────────────────────────────────────────────────────────────────────────────

import Image from 'next/image';

export interface ChapterLesson {
  id: string;
  title: string;
  content: string | null;
  video_url: string | null;
  order_index: number;
}

interface ChapterTemplateProps {
  lesson: ChapterLesson;
  /** Drop-in slot: page background image (optional) */
  backgroundSrc?: string;
  /** Drop-in slot: decorative character / mascot (optional) */
  characterSrc?: string;
  onPractice?: () => void;
  onQuiz?: () => void;
}

export default function ChapterTemplate({
  lesson,
  backgroundSrc,
  characterSrc,
  onPractice,
  onQuiz,
}: ChapterTemplateProps) {
  return (
    // ── Background slot ──────────────────────────────────────────────────────
    // Replace backgroundSrc to theme each chapter differently.
    <div className="relative min-h-0 flex flex-col gap-5">
      {backgroundSrc && (
        <Image
          src={backgroundSrc}
          alt=""
          fill
          className="object-cover object-bottom -z-10"
          aria-hidden
        />
      )}

      {/* ── Character slot (optional mascot beside content) ────────────── */}
      {characterSrc && (
        <div className="flex justify-center mb-2">
          <Image
            src={characterSrc}
            alt=""
            width={120}
            height={120}
            className="object-contain"
            aria-hidden
          />
        </div>
      )}

      {/* ── Video / media slot ───────────────────────────────────────────── */}
      <div className="w-full aspect-video bg-[#E8A87C]/30 border-4 border-[#E8A87C]/30 rounded-2xl flex items-center justify-center overflow-hidden">
        {lesson.video_url ? (
          <video
            src={lesson.video_url}
            controls
            className="w-full h-full object-contain"
          />
        ) : (
          /* Video placeholder — remove once actual video assets are linked */
          <div className="flex flex-col items-center gap-2 text-[#BF7B45]">
            <svg viewBox="0 0 24 24" className="w-12 h-12" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
            <p className="text-sm font-semibold">Video coming soon</p>
          </div>
        )}
      </div>

      {/* ── Lesson title ─────────────────────────────────────────────────── */}
      <h2 className="text-[#4A2C0A] font-black text-xl">{lesson.title}</h2>

      {/* ── Lesson content ───────────────────────────────────────────────── */}
      {lesson.content && (
        <p className="text-[#7B3F00] font-medium text-sm leading-relaxed whitespace-pre-wrap">
          {lesson.content}
        </p>
      )}

      {/* ── Action buttons ───────────────────────────────────────────────── */}
      <div className="flex gap-3 mt-2">
        <button
          onClick={onPractice}
          className="
            flex-1 bg-[#2E8B2E] hover:bg-[#329932] text-white
            font-black uppercase tracking-widest text-sm
            py-3 rounded-full
            shadow-[0_5px_0_#1a5c1a]
            active:translate-y-1 active:shadow-[0_2px_0_#1a5c1a]
            transition-all
          "
        >
          Practice
        </button>

        <button
          onClick={onQuiz}
          className="
            flex-1 bg-[#E8A87C] hover:bg-[#D4956A] text-[#4A2C0A]
            font-black uppercase tracking-widest text-sm
            py-3 rounded-full
            border-[3px] border-[#E8A87C]
            shadow-[0_5px_0_#8B6040]
            active:translate-y-1 active:shadow-[0_2px_0_#8B6040]
            transition-all
          "
        >
          Quiz
        </button>
      </div>
    </div>
  );
}
