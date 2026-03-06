// PAGE: Lessons Selection (Dashboard Home)
// ROUTE: /dashboard
// Shows all FSL lesson chapters as a 3-2 grid with lock/unlock states.
// Fetches levels and user_progress from Supabase.
// Navigates to /dashboard/lessons/[lessonId] on card click.
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import GearIcon from '@/public/images/svgs/gear-icon.svg';

interface LessonItem {
  id: string;
  lessonNumber: number;
  title: string;
  isUnlocked: boolean;
  /** Signs/topics covered — shown on card until real art is available */
  signs?: string[];
}

// ── Proposed curriculum (used when database has no levels yet) ──────────────
// Structure: 6 alphabet chapters → Early Checkpoint → Numbers → Phrases.
// Remove MOCK_LESSONS and the fallback once real data is seeded in Supabase.
//
// ADMIN NOTE: Additional lessons can be appended to any group below.
// Only admins should insert new rows into the `levels` table.
// See Supabase dashboard → Table Editor → levels (RLS: admin role required for INSERT).
const MOCK_LESSONS: LessonItem[] = [

  // ── Group 1: FSL Alphabet ──────────────────────────────────────────────────
  {
    id: 'mock-1',
    lessonNumber: 1,
    title: 'Alphabet A – E',
    signs: ['A', 'B', 'C', 'D', 'E'],
    isUnlocked: true,
  },
  {
    id: 'mock-2',
    lessonNumber: 2,
    title: 'Alphabet F – J',
    signs: ['F', 'G', 'H', 'I', 'J'],
    isUnlocked: false,
  },
  {
    id: 'mock-3',
    lessonNumber: 3,
    title: 'Alphabet K – O',
    signs: ['K', 'L', 'M', 'N', 'O'],
    isUnlocked: false,
  },
  {
    id: 'mock-4',
    lessonNumber: 4,
    title: 'Alphabet P – T',
    signs: ['P', 'Q', 'R', 'S', 'T'],
    isUnlocked: false,
  },
  {
    id: 'mock-5',
    lessonNumber: 5,
    title: 'Alphabet U – Y',
    signs: ['U', 'V', 'W', 'X', 'Y'],
    isUnlocked: false,
  },
  {
    id: 'mock-6',
    lessonNumber: 6,
    title: 'Alphabet Z – Ñ – NG',
    signs: ['Z', 'Ñ', 'NG'],
    isUnlocked: false,
  },
  // TODO (admin): Additional alphabet lessons can be inserted here.

  // ── Early Checkpoint ───────────────────────────────────────────────────────
  // An assessment covering all alphabet lessons (1–6) is placed here.
  // TODO (admin): Create an `assessment` record linked to levels 1–6 as the
  // checkpoint gate before the Numbers and Phrases groups are unlocked.

  // ── Group 2: Numbers ──────────────────────────────────────────────────────
  {
    id: 'mock-7',
    lessonNumber: 7,
    title: 'Numbers 0 – 9',
    signs: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
    isUnlocked: false,
  },
  // TODO (admin): Additional number lessons (e.g. 10–100) can be inserted here.

  // ── Group 3: Phrases ──────────────────────────────────────────────────────
  {
    id: 'mock-8',
    lessonNumber: 8,
    title: 'Common Phrases',
    signs: [
      'Good morning',   // Magandang umaga
      'Thank you',      // Salamat
      'How are you?',   // Kumusta ka?
      'My name is…',    // Ang pangalan ko ay…
      'I love you',     // Mahal kita
      'Please help me', // Tulungan mo ako
    ],
    isUnlocked: false,
  },
    
  // TODO (admin): Additional phrase lessons can be inserted here.
];

/* ── Lock icon ─────────────────────────────────────────────────────────────── */
function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-10 h-10 text-white drop-shadow-lg" fill="currentColor" aria-hidden>
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
    </svg>
  );
}

/* ── Single lesson card ────────────────────────────────────────────────────── */
function LessonCard({ lesson, onPress }: { lesson: LessonItem; onPress: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      {/* Card box — landscape, art slot inside */}
      <button
        onClick={onPress}
        disabled={!lesson.isUnlocked}
        aria-label={lesson.isUnlocked ? `Open ${lesson.title}` : `${lesson.title} — locked`}
        className={`
          relative w-full aspect-5/3 rounded-[28px] border-[5px] overflow-hidden
          transition-transform
          ${lesson.isUnlocked
            ? 'bg-[#E8A87C] border-[#BF7B45] hover:scale-[0.95] cursor-pointer shadow-md '
            : 'bg-[#C49070] border-[#8B6040] cursor-not-allowed opacity-80'
          }
        `}
      >
        {/* Art slot — replace this div with <Image> once assets are ready */}
        <div className="absolute inset-0 p-3 flex flex-wrap gap-1 content-center justify-center overflow-hidden">
          {lesson.signs?.map((s) => (
            <span
              key={s}
              className="bg-white/50 text-[#4A2C0A] font-bold text-[0.6rem] px-1.5 py-0.5 rounded-full leading-none"
            >
              {s}
            </span>
          ))}
        </div>

        {/* Lock overlay */}
        {!lesson.isUnlocked && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <LockIcon />
          </div>
        )}
      </button>

      {/* Label below the card */}
      <p className="text-[#4A2C0A] text-sm">
        <span className="font-black">Lesson {lesson.lessonNumber}</span>
        {'  '}
        <span className="font-medium">{lesson.title}</span>
      </p>
    </div>
  );
}

// 5 lessons per page: row 1 = 3 cards, row 2 = 2 cards centred.
const LESSONS_PER_PAGE = 5;

/* ── Nav arrow button ──────────────────────────────────────────────────────── */
function NavArrow({ direction, onClick }: { direction: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-11 h-11 rounded-full bg-[#E8A87C] border-[3px] border-[#BF7B45] flex items-center justify-center shadow-md hover:scale-105 active:scale-95 transition-transform z-10"
      aria-label={direction === 'right' ? 'Next page' : 'Previous page'}
    >
      <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
        {direction === 'right'
          ? <path d="M4 11h12.17l-5.59-5.59L12 4l8 8-8 8-1.41-1.41L16.17 13H4v-2z" />
          : <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
        }
      </svg>
    </button>
  );
}

/* ── Dashboard page ────────────────────────────────────────────────────────── */
export default function Dashboard() {
  const router = useRouter();
  const [lessons,     setLessons]     = useState<LessonItem[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [currentPage, setCurrentPage] = useState(0);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/'); return; }

      const [levelsRes, progressRes] = await Promise.all([
        supabase.from('levels').select('id, name, level_order').order('level_order'),
        supabase.from('user_progress').select('level_id, is_unlocked').eq('auth_user_id', user.id),
      ]);

      const unlockedIds = new Set(
        progressRes.data?.filter((p) => p.is_unlocked).map((p) => p.level_id) ?? []
      );

      const dbLevels = levelsRes.data ?? [];

      // Fall back to MOCK_LESSONS when the database has no levels yet.
      // Remove this fallback (and MOCK_LESSONS above) once data is seeded.
      if (dbLevels.length === 0) {
        setLessons(MOCK_LESSONS);
      } else {
        setLessons(
          dbLevels.map((lvl, i) => ({
            id:           lvl.id,
            lessonNumber: i + 1,
            title:        lvl.name,
            isUnlocked:   unlockedIds.has(lvl.id),
          }))
        );
      }
      setLoading(false);
    }

    init();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p className="text-[#7B3F00] font-bold text-lg animate-pulse">Loading…</p>
      </div>
    );
  }

  // Chunk lessons into pages of 5 (3 + 2 per page).
  const pages: LessonItem[][] = [];
  for (let i = 0; i < lessons.length; i += LESSONS_PER_PAGE) {
    pages.push(lessons.slice(i, i + LESSONS_PER_PAGE));
  }
  const totalPages = pages.length;
  const hasNext    = currentPage < totalPages - 1;
  const hasPrev    = currentPage > 0;

  return (
    <div className="min-h-screen bg-white px-6 pt-5 pb-12 overflow-x-hidden">

      {/* ── Top bar ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <button
          onClick={() => router.replace('/')}
          className="w-11 h-11 rounded-full bg-[#E8A87C] border-[3px] border-[#BF7B45] flex items-center justify-center shadow-md hover:scale-105 transition-transform"
          aria-label="Back to home"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>

        <button
          className="w-11 h-11 rounded-full bg-[#E8A87C] border-[3px] border-[#BF7B45] flex items-center justify-center shadow-md hover:scale-105 transition-transform"
          aria-label="Settings"
        >
          <Image src={GearIcon} alt="" width={22} height={22} aria-hidden />
        </button>
      </div>

      {/* ── Title ──────────────────────────────────────────────────── */}
      <div className="text-center mb-2">
        <h1
          className="font-black text-[2.4rem] leading-tight"
          style={{
            fontFamily: 'var(--font-baloo)',
            color: '#2E7D1C',
            WebkitTextStroke: '2px #1a4d10',
            textShadow: '3px 3px 0 #1a4d10',
          }}
        >
          Let&apos;s learn FSL!
        </h1>
        <p className="text-[#4A2C0A] font-bold text-base mt-1">
          Choose a lesson to begin learning and practicing.
        </p>
      </div>

      {/* ── Horizontal paging grid ─────────────────────────────────── */}
      {/*
        Layout per page:
          Row 1: [Card][Card][Card]          ← always 3
          Row 2:    [Card][Card]             ← up to 2, centred

        Right arrow appears at the right edge between the two rows.
        Left  arrow appears at the left  edge in the same position.
        Arrows slide the track; the page never scrolls vertically.
      */}
      <div className="relative mt-8">

        {/* ── Left nav arrow ─────────────────────────────────────── */}
        {hasPrev && (
          <div className="absolute left-0 top-[38%] -translate-y-1/2 -translate-x-5 z-10">
            <NavArrow direction="left" onClick={() => setCurrentPage((p) => p - 1)} />
          </div>
        )}

        {/* ── Right nav arrow ────────────────────────────────────── */}
        {hasNext && (
          <div className="absolute right-0 top-[38%] -translate-y-1/2 translate-x-5 z-10">
            <NavArrow direction="right" onClick={() => setCurrentPage((p) => p + 1)} />
          </div>
        )}

        {/* ── Slide track ────────────────────────────────────────── */}
        <div className="overflow-hidden">
          <div
            className="flex transition-transform duration-500 ease-in-out"
            style={{ transform: `translateX(-${currentPage * 100}%)` }}
          >
            {pages.map((page, pageIdx) => {
              const row1 = page.slice(0, 3);
              const row2 = page.slice(3, 5);

              return (
                <div key={pageIdx} className="w-full flex-shrink-0 flex flex-col gap-6">

                  {/* Row 1 — always 3 cards */}
                  <div className="grid grid-cols-3 gap-6">
                    {row1.map((lesson) => (
                      <LessonCard
                        key={lesson.id}
                        lesson={lesson}
                        onPress={() => router.push(`/dashboard/lessons/${lesson.id}`)}
                      />
                    ))}
                  </div>

                  {/* Row 2 — up to 2 cards, centred */}
                  {row2.length > 0 && (
                    <div className="w-2/3 mx-auto grid grid-cols-2 gap-6">
                      {row2.map((lesson) => (
                        <LessonCard
                          key={lesson.id}
                          lesson={lesson}
                          onPress={() => router.push(`/dashboard/lessons/${lesson.id}`)}
                        />
                      ))}
                    </div>
                  )}

                </div>
              );
            })}
          </div>
        </div>

        {/* ── Page indicator dots ────────────────────────────────── */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-6">
            {pages.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i)}
                aria-label={`Go to page ${i + 1}`}
                className={`
                  rounded-full transition-all duration-300
                  ${i === currentPage
                    ? 'w-5 h-2.5 bg-[#BF7B45]'
                    : 'w-2.5 h-2.5 bg-[#BF7B45]/30 hover:bg-[#BF7B45]/60'
                  }
                `}
              />
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
