'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';

export interface LessonCardProps {
  id: string;
  lessonNumber: number;
  title: string;
  isUnlocked: boolean;
  /** Drop-in slot for future lesson art — omit to show placeholder */
  artSrc?: string;
}

export default function LessonCard({
  id,
  lessonNumber,
  title,
  isUnlocked,
  artSrc,
}: LessonCardProps) {
  const router = useRouter();

  return (
    <button
      onClick={() => isUnlocked && router.push(`/dashboard/lessons/${id}`)}
      disabled={!isUnlocked}
      aria-label={isUnlocked ? `Open ${title}` : `${title} — locked`}
      className={`
        relative flex flex-col w-full rounded-[20px] border-[5px] overflow-hidden
        text-left transition-transform
        ${isUnlocked
          ? 'bg-[#E8A87C] border-[#BF7B45] hover:scale-105 cursor-pointer shadow-md'
          : 'bg-[#C49070] border-[#8B6040] cursor-not-allowed opacity-80'
        }
      `}
    >
      {/* ── Art slot ─────────────────────────────────────────────── */}
      {/* Replace artSrc with a real image once assets are ready.    */}
      <div className="relative w-full aspect-square bg-[#D4956A]/40 flex items-center justify-center overflow-hidden">
        {artSrc ? (
          <Image src={artSrc} alt={title} fill className="object-cover" />
        ) : (
          /* Placeholder — swap for actual lesson illustration */
          <svg
            viewBox="0 0 80 80"
            className="w-16 h-16 text-[#BF7B45]/50"
            fill="currentColor"
            aria-hidden
          >
            <rect x="10" y="10" width="60" height="60" rx="8" opacity="0.3" />
            <circle cx="30" cy="30" r="8" opacity="0.5" />
            <path d="M10 55 L30 35 L50 50 L60 40 L70 55 Z" opacity="0.4" />
          </svg>
        )}

        {/* Lock overlay */}
        {!isUnlocked && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <svg
              viewBox="0 0 24 24"
              className="w-10 h-10 text-white drop-shadow-lg"
              fill="currentColor"
              aria-hidden
            >
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
            </svg>
          </div>
        )}
      </div>

      {/* ── Label area ───────────────────────────────────────────── */}
      <div className="px-3 py-2">
        <p className="text-[#4A2C0A] font-black text-sm leading-tight">
          Lesson {lessonNumber}
        </p>
        <p className="text-[#7B3F00] font-semibold text-xs mt-0.5 line-clamp-1">
          {title}
        </p>
      </div>
    </button>
  );
}
