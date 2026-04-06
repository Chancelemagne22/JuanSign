'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import BannerBg from '@/public/images/svgs/completed_banner.svg';
import CompletedArc from '@/public/images/svgs/completed_arc.svg';

const CONFETTI_COLORS = ['#FFD447', '#33AA11', '#FF9900', '#4C8EF7', '#FFFFFF'];
const CONFETTI_PIECES = Array.from({ length: 64 }, (_, i) => ({
  id: i,
  left: `${3 + ((i * 31) % 94)}%`,
  delay: `-${(i % 10) * 0.22}s`,
  duration: `${2.2 + (i % 6) * 0.35}s`,
  size: `${10 + (i % 4) * 3}px`,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  drift: `${-36 + ((i * 9) % 72)}px`,
}));

const BURST_PARTICLES = Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * Math.PI * 2;
  const radius = 26 + (i % 4) * 6;
  return {
    id: i,
    x: `${Math.cos(angle) * radius}px`,
    y: `${Math.sin(angle) * radius}px`,
    delay: `${(i % 6) * 0.14}s`,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  };
});

interface LessonCompleteModalProps {
  mode: 'lesson' | 'practice' | 'assessment';
  levelNumber?: number;
  onReplay: () => void;
  onNext: () => void;
  onClose: () => void;
}

export default function LessonCompleteModal({
  mode,
  levelNumber,
  onReplay,
  onNext,
  onClose,
}: LessonCompleteModalProps) {
  const [isVisible, setIsVisible] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const nextBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const frame = window.requestAnimationFrame(() => setIsVisible(true));
    nextBtnRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusables = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );

      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const headerPrefix = mode === 'practice' ? 'Practice' : mode === 'assessment' ? 'Assessment' : 'Lesson';
  const message =
    mode === 'practice'
      ? "You've completed this practice level! Keep your momentum and continue to the assessment."
      : mode === 'assessment'
        ? "Great work! You've completed this assessment level. Keep practicing to improve even more."
        : "You've successfully finished the lesson! Now it's time to practice what you learned.";

  return (
    <div
      className={`fixed inset-0 z-[12000] flex items-center justify-center bg-black/45 p-4 transition-opacity duration-200 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      aria-hidden={false}
    >
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
        {CONFETTI_PIECES.map((piece) => (
          <span
            key={piece.id}
            className="lesson-confetti-piece"
            style={{
              left: piece.left,
              width: piece.size,
              height: piece.size,
              backgroundColor: piece.color,
              animationDelay: piece.delay,
              animationDuration: piece.duration,
              ['--drift' as string]: piece.drift,
            }}
          />
        ))}

        <div className="lesson-burst lesson-burst--left">
          {BURST_PARTICLES.map((spark) => (
            <span
              key={`left-${spark.id}`}
              className="lesson-burst-spark"
              style={{
                ['--x' as string]: spark.x,
                ['--y' as string]: spark.y,
                animationDelay: spark.delay,
                backgroundColor: spark.color,
              }}
            />
          ))}
        </div>

        <div className="lesson-burst lesson-burst--right">
          {BURST_PARTICLES.map((spark) => (
            <span
              key={`right-${spark.id}`}
              className="lesson-burst-spark"
              style={{
                ['--x' as string]: spark.x,
                ['--y' as string]: spark.y,
                animationDelay: spark.delay,
                backgroundColor: spark.color,
              }}
            />
          ))}
        </div>
      </div>

      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Lesson Completed"
        className={`relative z-30 w-full max-w-[330px] aspect-[539/743] overflow-visible rounded-[50px] transition-all duration-200 ${
          isVisible ? 'translate-y-5 scale-100' : 'translate-y-7 scale-95'
        }`}
      >
        <Image
          src={BannerBg}
          alt=""
          fill
          priority
          aria-hidden
          className="-z-10 rounded-[50px] object-contain"
        />

        <div className="absolute left-1/2 top-0 w-[150%] max-w-none -translate-x-1/2 -translate-y-[52%]">
          <Image src={CompletedArc} alt="Completed" className="h-auto w-full" priority />
        </div>

        <div className="h-full flex flex-col px-7 pb-8 pt-[4.9rem] sm:px-8 sm:pt-[5.6rem]">
          <div className="mx-auto w-full max-w-[272px] text-center translate-y-5">
            <p
              className="text-[1.4rem] sm:text-[1.6rem] font-medium leading-none"
              style={{
                fontFamily: 'var(--font-spicy-rice)',
                color: '#1E88FF',
                textShadow: '0 4px 4px #152978',
              }}
            >
              {headerPrefix}{levelNumber ? ` ${levelNumber}` : ''}
            </p>
            <h2
              className="mt-1 text-[2.45rem] sm:text-[2.7rem] font-black leading-[0.9] tracking-wide"
              style={{
                fontFamily: 'var(--font-spicy-rice)',
                color: '#FFFFFF',
                textShadow: '0 5px 0 #B16A36',
              }}
            >
              COMPLETED
            </h2>
            <p className="mx-auto mt-5 translate-y-2 max-w-[250px] text-sm sm:text-[0.95rem] font-semibold text-[#FFF6E8] leading-[1.55]">
              {message}
            </p>
          </div>

          <div className="mt-auto pt-5 pb-7 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={onReplay}
              aria-label="Replay lesson"
              className="relative flex h-14 w-14 items-center justify-center rounded-full border-0 bg-[linear-gradient(180deg,#ffcc44_0%,#ff9900_100%)] text-white shadow-[0_6px_0_#b86a00,0_8px_16px_rgba(0,0,0,0.3)] transition-transform hover:scale-105 active:translate-y-[4px] active:shadow-[0_2px_0_#b86a00,0_4px_8px_rgba(0,0,0,0.2)]"
            >
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden>
                <path d="M12 5a7 7 0 1 1-6.57 9.4 1 1 0 1 1 1.88-.68A5 5 0 1 0 12 7h-1.59l1.3 1.29a1 1 0 1 1-1.42 1.42L6.59 6l3.7-3.71a1 1 0 0 1 1.42 1.42L10.41 5H12z" />
              </svg>
            </button>

            <button
              ref={nextBtnRef}
              type="button"
              onClick={onClose}
              aria-label="Back to lessons"
              className="relative flex h-14 w-14 items-center justify-center rounded-full border-0 bg-[linear-gradient(180deg,#ffcc44_0%,#ff9900_100%)] text-white shadow-[0_6px_0_#b86a00,0_8px_16px_rgba(0,0,0,0.3)] transition-transform hover:scale-105 active:translate-y-[4px] active:shadow-[0_2px_0_#b86a00,0_4px_8px_rgba(0,0,0,0.2)]"
            >
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden>
                <path d="M12 3l9 7h-3v10h-5v-6H11v6H6V10H3l9-7z" />
              </svg>
            </button>

            <button
              type="button"
              onClick={onNext}
              aria-label="Next lesson"
              className="relative flex h-14 w-14 items-center justify-center rounded-full border-0 bg-[linear-gradient(180deg,#ffcc44_0%,#ff9900_100%)] text-white shadow-[0_6px_0_#b86a00,0_8px_16px_rgba(0,0,0,0.3)] transition-transform hover:scale-105 active:translate-y-[4px] active:shadow-[0_2px_0_#b86a00,0_4px_8px_rgba(0,0,0,0.2)]"
            >
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden>
                <path d="M9 5l7 7-7 7-1.4-1.4 4.6-4.6H4v-2h8.2L7.6 6.4z" />
              </svg>
            </button>
          </div>
        </div>

        <style jsx global>{`
          .lesson-confetti-piece {
            position: absolute;
            top: -10%;
            border-radius: 2px;
            opacity: 0;
            animation-name: lesson-confetti-fall;
            animation-timing-function: ease-out;
            animation-iteration-count: infinite;
            box-shadow: 0 0 14px rgba(255, 255, 255, 0.95);
          }

          .lesson-burst {
            position: absolute;
            top: 30%;
            width: 2px;
            height: 2px;
            opacity: 0.9;
          }

          .lesson-burst--left {
            left: 8%;
          }

          .lesson-burst--right {
            right: 8%;
          }

          .lesson-burst-spark {
            position: absolute;
            width: 7px;
            height: 7px;
            border-radius: 999px;
            opacity: 0;
            box-shadow: 0 0 10px rgba(255, 255, 255, 0.8);
            animation: lesson-burst-pop 1.6s ease-out infinite;
          }

          @keyframes lesson-confetti-fall {
            0% {
              opacity: 0;
              transform: translate(0, 0) rotate(0deg);
            }
            12% {
              opacity: 1;
            }
            70% {
              opacity: 0.95;
            }
            100% {
              opacity: 0;
              transform: translate(var(--drift), 110vh) rotate(540deg);
            }
          }

          @keyframes lesson-burst-pop {
            0% {
              opacity: 0;
              transform: translate(0, 0) scale(0.4);
            }
            24% {
              opacity: 1;
            }
            100% {
              opacity: 0;
              transform: translate(var(--x), var(--y)) scale(0.9);
            }
          }
        `}</style>
      </div>
    </div>
  );
}
