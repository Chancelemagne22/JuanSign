// PAGE: Lessons Overview (alternate route — same content as /dashboard)
// ROUTE: /dashboard/lessons
// Duplicate lessons grid kept for direct deep-link access.
// Consider redirecting this route to /dashboard if not needed separately.
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import LessonCard from '@/components/lessons/LessonCard';
import GearIcon from '@/public/images/svgs/gear-icon.svg';

interface LessonRow {
  id: string;
  lessonNumber: number;
  title: string;
  isUnlocked: boolean;
}

export default function LessonsPage() {
  const router = useRouter();
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/'); return; }

      const [levelsRes, progressRes] = await Promise.all([
        supabase.from('levels').select('id, name').order('name'),
        supabase
          .from('user_progress')
          .select('level_id, is_unlocked')
          .eq('auth_user_id', user.id),
      ]);

      const unlockedIds = new Set(
        progressRes.data?.filter((p) => p.is_unlocked).map((p) => p.level_id) ?? []
      );

      setLessons(
        (levelsRes.data ?? []).map((lvl, i) => ({
          id:           lvl.id,
          lessonNumber: i + 1,
          title:        lvl.name,
          isUnlocked:   unlockedIds.has(lvl.id),
        }))
      );
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

  // Split lessons into rows of 3; last row may have 1 or 2 cards (centered).
  const rows: LessonRow[][] = [];
  for (let i = 0; i < lessons.length; i += 3) {
    rows.push(lessons.slice(i, i + 3));
  }

  return (
    <div className="min-h-screen bg-white px-5 pt-5 pb-10">

      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => router.back()}
          className="w-10 h-10 rounded-full bg-[#E8A87C] border-2 border-[#BF7B45] flex items-center justify-center shadow hover:scale-105 transition-transform"
          aria-label="Go back"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#4A2C0A]" fill="currentColor" aria-hidden>
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>

        <button
          className="w-10 h-10 rounded-full bg-[#E8A87C] border-2 border-[#BF7B45] flex items-center justify-center shadow hover:scale-105 transition-transform"
          aria-label="Settings"
        >
          <Image src={GearIcon} alt="" width={20} height={20} aria-hidden />
        </button>
      </div>

      {/* ── Title ────────────────────────────────────────────────── */}
      <h1
        className="font-black text-[2rem] leading-tight mb-1"
        style={{
          color: '#2E7D1C',
          WebkitTextStroke: '1.5px #1a4d10',
          textShadow: '2px 2px 0 #1a4d10',
        }}
      >
        Let&apos;s learn FSL!
      </h1>
      <p className="text-[#7B3F00] font-semibold text-sm mb-6">
        Choose a lesson to begin learning and practicing.
      </p>

      {/* ── Lessons grid ─────────────────────────────────────────── */}
      {/* Each row of 3 fills full width; partial last rows are centred. */}
      <div className="flex flex-col gap-4">
        {rows.map((row, rowIdx) => {
          const cols = row.length; // 1, 2, or 3
          const widthClass =
            cols === 3 ? 'w-full'
            : cols === 2 ? 'w-2/3 mx-auto'
            :              'w-1/3 mx-auto';

          return (
            <div
              key={rowIdx}
              className={`grid gap-4 ${widthClass}`}
              style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
            >
              {row.map((lesson) => (
                <LessonCard
                  key={lesson.id}
                  id={lesson.id}
                  lessonNumber={lesson.lessonNumber}
                  title={lesson.title}
                  isUnlocked={lesson.isUnlocked}
                />
              ))}
            </div>
          );
        })}
      </div>

    </div>
  );
}
