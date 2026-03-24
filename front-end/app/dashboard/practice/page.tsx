'use client';

// PAGE: Practice Chapter List
// ROUTE: /dashboard/practice
//
// Unlock rules:
//   Chapter 1  — unlocked when Lesson 1 is completed (lessons_completed > 0)
//   Chapter N  — unlocked when Practice N-1 has a practice_sessions record

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import GearIcon from '@/public/images/svgs/gear-icon.svg';

interface ChapterItem {
  id:         string;
  chapterNum: number;
  title:      string;
  isUnlocked: boolean;
  hasContent: boolean;
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-8 h-8 text-white drop-shadow" fill="currentColor" aria-hidden>
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
    </svg>
  );
}

function ChapterCard({ chapter, onPress }: { chapter: ChapterItem; onPress: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={onPress}
        disabled={!chapter.isUnlocked}
        aria-label={chapter.isUnlocked ? `Open ${chapter.title}` : `${chapter.title} — locked`}
        className={`
          relative w-full aspect-5/3 rounded-[28px] border-[5px] overflow-hidden transition-transform
          ${chapter.isUnlocked
            ? 'bg-[#E8A87C] border-[#BF7B45] hover:scale-[0.95] cursor-pointer shadow-md'
            : 'bg-[#C49070] border-[#8B6040] cursor-not-allowed opacity-80'
          }
        `}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="font-black text-white/70 leading-none select-none"
            style={{ fontSize: 'clamp(1.5rem, 6vw, 3rem)', fontFamily: 'var(--font-baloo)' }}
          >
            {chapter.chapterNum}
          </span>
        </div>
        {!chapter.isUnlocked && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <LockIcon />
          </div>
        )}
        {chapter.isUnlocked && !chapter.hasContent && (
          <div className="absolute top-2 right-2 bg-amber-400 rounded-full w-6 h-6 flex items-center justify-center text-xs">
            🚧
          </div>
        )}
      </button>
      <p className="text-[#4A2C0A] text-sm">
        <span className="font-black">Chapter {chapter.chapterNum}</span>
        {'  '}
        <span className="font-medium">{chapter.title}</span>
      </p>
    </div>
  );
}

const CHAPTERS_PER_PAGE = 5;

export default function PracticePage() {
  const router = useRouter();
  const [chapters,    setChapters]    = useState<ChapterItem[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [currentPage, setCurrentPage] = useState(0);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/'); return; }

      const [levelsRes, progressRes, sessionsRes, contentRes] = await Promise.all([
        supabase.from('levels').select('level_id, level_name, level_order').order('level_order'),
        supabase
          .from('user_progress')
          .select('level_id, lessons_completed')
          .eq('auth_user_id', user.id),
        supabase
          .from('practice_sessions')
          .select('level_id')
          .eq('auth_user_id', user.id),
        supabase
          .from('practice_questions')
          .select('level_id')
          .eq('question_type', 'perform'),
      ]);

      const levels        = levelsRes.data  ?? [];
      const progress      = progressRes.data ?? [];
      const doneSessions  = new Set((sessionsRes.data ?? []).map((s) => s.level_id));
      const levelsWithContent = new Set((contentRes.data ?? []).map((q) => q.level_id));

      // Map level_id → lessons_completed
      const progressMap = new Map(progress.map((p) => [p.level_id, p.lessons_completed ?? 0]));

      const chapters: ChapterItem[] = levels.map((lvl, i) => {
        let isUnlocked = false;

        if (i === 0) {
          isUnlocked = (progressMap.get(lvl.level_id) ?? 0) > 0;
        } else {
          const prevLevelId = levels[i - 1].level_id;
          isUnlocked = doneSessions.has(prevLevelId);
        }

        return {
          id:         lvl.level_id,
          chapterNum: i + 1,
          title:      lvl.level_name,
          isUnlocked,
          hasContent: levelsWithContent.has(lvl.level_id),
        };
      });

      setChapters(chapters);
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

  const pages: ChapterItem[][] = [];
  for (let i = 0; i < chapters.length; i += CHAPTERS_PER_PAGE) {
    pages.push(chapters.slice(i, i + CHAPTERS_PER_PAGE));
  }
  const totalPages = pages.length;
  const hasNext    = currentPage < totalPages - 1;
  const hasPrev    = currentPage > 0;

  return (
    <div className="min-h-screen bg-white px-6 pt-5 pb-12 overflow-x-hidden">

      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <button
          onClick={() => router.replace('/dashboard')}
          className="w-11 h-11 rounded-full bg-[#E8A87C] border-[3px] border-[#BF7B45] flex items-center justify-center shadow-md hover:scale-105 transition-transform"
          aria-label="Back to menu"
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

      {/* ── Title ────────────────────────────────────────────────── */}
      <div className="text-center mb-8">
        <h1
          className="font-black text-[2rem] leading-tight"
          style={{
            fontFamily:       'var(--font-spicy-rice)',
            color:            '#CC2200',
            WebkitTextStroke: '1.5px #881500',
            textShadow:       '2px 2px 0 #881500',
          }}
        >
          Practice
        </h1>
        <p className="text-[#4A2C0A] font-bold text-sm mt-1">
          Show the signs — practice makes perfect!
        </p>
      </div>

      {/* ── Chapter grid ─────────────────────────────────────────── */}
      <div className="relative mt-4">
        {hasPrev && (
          <div className="absolute left-0 top-[38%] -translate-y-1/2 -translate-x-5 z-10">
            <button
              onClick={() => setCurrentPage((p) => p - 1)}
              className="w-11 h-11 rounded-full bg-[#E8A87C] border-[3px] border-[#BF7B45] flex items-center justify-center shadow-md hover:scale-105 transition-transform"
              aria-label="Previous page"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
              </svg>
            </button>
          </div>
        )}
        {hasNext && (
          <div className="absolute right-0 top-[38%] -translate-y-1/2 translate-x-5 z-10">
            <button
              onClick={() => setCurrentPage((p) => p + 1)}
              className="w-11 h-11 rounded-full bg-[#E8A87C] border-[3px] border-[#BF7B45] flex items-center justify-center shadow-md hover:scale-105 transition-transform"
              aria-label="Next page"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
                <path d="M4 11h12.17l-5.59-5.59L12 4l8 8-8 8-1.41-1.41L16.17 13H4v-2z" />
              </svg>
            </button>
          </div>
        )}

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
                  <div className="grid grid-cols-3 gap-6">
                    {row1.map((ch) => (
                      <ChapterCard
                        key={ch.id}
                        chapter={ch}
                        onPress={() => router.push(`/dashboard/practice/${ch.id}`)}
                      />
                    ))}
                  </div>
                  {row2.length > 0 && (
                    <div className="w-2/3 mx-auto grid grid-cols-2 gap-6">
                      {row2.map((ch) => (
                        <ChapterCard
                          key={ch.id}
                          chapter={ch}
                          onPress={() => router.push(`/dashboard/practice/${ch.id}`)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-6">
            {pages.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i)}
                aria-label={`Go to page ${i + 1}`}
                className={`rounded-full transition-all duration-300 ${
                  i === currentPage ? 'w-5 h-2.5 bg-[#BF7B45]' : 'w-2.5 h-2.5 bg-[#BF7B45]/30 hover:bg-[#BF7B45]/60'
                }`}
              />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
