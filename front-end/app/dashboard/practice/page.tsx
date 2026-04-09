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
import { useSettingsModal } from '@/hooks/useSettings';
import { useLanguage } from '@/hooks/useLanguage';

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

function ChapterCard({
  chapter,
  onPress,
  t,
}: {
  chapter: ChapterItem;
  onPress: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="chapter-card-item flex flex-col gap-1 sm:gap-1.5">
      <button
        onClick={onPress}
        disabled={!chapter.isUnlocked}
        aria-label={chapter.isUnlocked ? `Open ${chapter.title}` : `${chapter.title} — locked`}
        className={`
          chapter-card-button relative overflow-hidden transition-transform
          ${chapter.isUnlocked
            ? 'bg-[#E8A87C] border-[#E8A87C] hover:scale-[0.95] cursor-pointer shadow-md'
            : 'bg-[#C49070] border-[#C49070] cursor-not-allowed opacity-80'
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
      <p className="chapter-card-caption text-[#4A2C0A]">
        <span className="font-black">{t('common.levelLabel').replace('{{number}}', String(chapter.chapterNum))}</span>
        {'  '}
        <span className="font-medium">{chapter.title}</span>
      </p>
    </div>
  );
}

export default function PracticePage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { openSettings } = useSettingsModal();
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [usePagedLayout, setUsePagedLayout] = useState(false);

  const DESKTOP_PAGE_SIZE = 8;

  useEffect(() => {
    const updateLayoutMode = () => setUsePagedLayout(window.innerWidth >= 1024);
    updateLayoutMode();
    window.addEventListener('resize', updateLayoutMode);
    return () => window.removeEventListener('resize', updateLayoutMode);
  }, []);

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
          .eq('user_id', user.id),
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

  const totalPages = usePagedLayout
    ? Math.max(1, Math.ceil(chapters.length / DESKTOP_PAGE_SIZE))
    : 1;

  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, totalPages - 1));
  }, [totalPages]);

  const visibleChapters = usePagedLayout
    ? chapters.slice(currentPage * DESKTOP_PAGE_SIZE, (currentPage + 1) * DESKTOP_PAGE_SIZE)
    : chapters;

  const hasPrev = currentPage > 0;
  const hasNext = currentPage < totalPages - 1;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p className="text-[#7B3F00] font-bold text-lg animate-pulse">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-white px-4 sm:px-6 pt-4 pb-3 overflow-hidden flex flex-col">

      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3 sm:mb-4">
        <button
          onClick={() => router.replace('/dashboard')}
          className="flex items-center justify-center flex-shrink-0 transition-transform"
          style={{
            zIndex: 9999,
            width: 'clamp(36px, 6vw, 44px)',
            height: 'clamp(36px, 6vw, 44px)',
            borderRadius: '50%',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            background: 'linear-gradient(180deg, #ffcc44 0%, #ff9900 100%)',
            boxShadow: '0 6px 0 #b86a00, 0 8px 16px rgba(0, 0, 0, 0.3)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.1)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'translateY(4px) scale(0.96)', e.currentTarget.style.boxShadow = '0 2px 0 #b86a00, 0 4px 8px rgba(0, 0, 0, 0.2)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1.1)', e.currentTarget.style.boxShadow = '0 6px 0 #b86a00, 0 8px 16px rgba(0, 0, 0, 0.3)')}
          aria-label={t('common.backToMenu')}
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>
        <button
          onClick={openSettings}
          className="flex items-center justify-center flex-shrink-0 transition-transform"
          style={{
            zIndex: 9999,
            width: 'clamp(36px, 6vw, 44px)',
            height: 'clamp(36px, 6vw, 44px)',
            borderRadius: '50%',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            background: 'linear-gradient(180deg, #ffcc44 0%, #ff9900 100%)',
            boxShadow: '0 6px 0 #b86a00, 0 8px 16px rgba(0, 0, 0, 0.3)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.1)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'translateY(4px) scale(0.96)', e.currentTarget.style.boxShadow = '0 2px 0 #b86a00, 0 4px 8px rgba(0, 0, 0, 0.2)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1.1)', e.currentTarget.style.boxShadow = '0 6px 0 #b86a00, 0 8px 16px rgba(0, 0, 0, 0.3)')}
          aria-label={t('settings.openSettings')}
        >
          <Image src={GearIcon} alt="" style={{ width: '50%', height: '50%' }} />
        </button>
      </div>

      {/* ── Title ────────────────────────────────────────────────── */}
      <div className="text-center mb-2 sm:mb-3">
        <h1
          className="heading-xl"
          style={{
            fontFamily:       'var(--font-spicy-rice)',
            color:            '#FF6600',
            WebkitTextStroke: '1px #A14E08',
            textShadow:       '1px 1px 0 #A14E08',
          }}
        >
          {t('practicePage.title')}
        </h1>
        <p className="text-[#4A2C0A] font-bold text-base sm:text-lg mt-0.5">
          {t('practicePage.subtitle')}
        </p>
      </div>

      {/* ── Chapter gallery ──────────────────────────────────────── */}
      <div className="mt-2 flex-1 min-h-0 overflow-hidden">
        <div
          className={`lesson-gallery-scroll h-full px-0 sm:px-1 ${
            usePagedLayout ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden'
          }`}
        >
          <div className="lesson-gallery-shell mx-auto">
            <div className="lesson-gallery-grid">
              {visibleChapters.map((ch) => (
                <ChapterCard
                  key={ch.id}
                  chapter={ch}
                  t={t}
                  onPress={() => router.push(`/dashboard/practice/${ch.id}`)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {usePagedLayout && (
        <div className="flex-shrink-0 mt-3 sm:mt-4 flex items-center justify-center gap-2">
          <button
            onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
            disabled={!hasPrev}
            className="px-3 py-1.5 rounded-full text-sm font-bold border border-[#BF7B45] text-[#7B3F00] disabled:opacity-40"
            aria-label={t('practicePage.previousPracticePage')}
          >
            {t('common.previous')}
          </button>
          <span className="text-xs sm:text-sm text-[#7B3F00] font-semibold px-2">
            {currentPage + 1} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={!hasNext}
            className="px-3 py-1.5 rounded-full text-sm font-bold border border-[#BF7B45] text-[#7B3F00] disabled:opacity-40"
            aria-label={t('practicePage.nextPracticePage')}
          >
            {t('common.next')}
          </button>
        </div>
      )}

    </div>
  );
}
