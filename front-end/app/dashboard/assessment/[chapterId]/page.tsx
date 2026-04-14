'use client';

// PAGE: Assessment Chapter (Template)
// ROUTE: /dashboard/assessment/[chapterId]
//
// Hosts the AssessmentView for a single chapter.
// Full scoring logic (questions, ML predictions, stars, results) is TODO —
// see AssessmentView component for the implementation checklist.
//
// On finish:
//   - Navigates back to /dashboard/assessment

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import AssessmentView from '@/components/module/AssessmentView';
import type { AssessmentQuestion } from '@/components/module/AssessmentView';
import type { AssessmentCompletionSummary } from '@/components/module/AssessmentView';
import LessonCompleteModal from '@/components/module/LessonCompleteModal';
import GearIcon from '@/public/images/svgs/gear-icon.svg';
import { useSettings, useSettingsModal } from '@/hooks/useSettings';
import { useLanguage } from '@/hooks/useLanguage';

interface LevelMeta {
  levelNum: number;
  label:    string;
}

export default function AssessmentChapterPage() {
  const router            = useRouter();
  const { chapterId }     = useParams<{ chapterId: string }>();
  const { t } = useLanguage();
  const { settings } = useSettings();
  const { openSettings } = useSettingsModal();

  const [levelMeta,     setLevelMeta]     = useState<LevelMeta | null>(null);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showCompleteModal, setShowCompleteModal] = useState(false);

  async function handleAssessmentFinish(summary: AssessmentCompletionSummary) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setShowCompleteModal(true);
        return;
      }

      await supabase.from('assessment_results').insert({
        auth_user_id: user.id,
        level_id: chapterId,
        score: summary.scorePercent,
        stars_earned: summary.starsEarned,
        time_taken_seconds: elapsedSeconds,
        is_passed: summary.isPassed,
      });

      if (summary.isPassed) {
        const { data: nextLevel } = await supabase
          .from('levels')
          .select('level_id')
          .eq('previous_level_id', chapterId)
          .single();

        if (nextLevel) {
          await supabase
            .from('user_progress')
            .upsert(
              { auth_user_id: user.id, level_id: nextLevel.level_id, is_unlocked: true },
              { onConflict: 'auth_user_id,level_id' },
            );
        }
      }
    } catch (error) {
      console.error('[assessment chapter] failed to persist assessment result:', error);
    } finally {
      setShowCompleteModal(true);
    }
  }

  useEffect(() => {
    if (!settings.showTimer) return;

    const timerId = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [settings.showTimer]);

  const timerLabel = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`;

  useEffect(() => {
    async function init() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.replace('/'); return; }

        const [levelRes, questionRes] = await Promise.all([
          supabase
            .from('levels')
            .select('level_name, level_order')
            .eq('level_id', chapterId)
            .single(),
          fetch(`/api/assessment/questions?levelId=${encodeURIComponent(chapterId)}&status=active`, {
            cache: 'no-store',
          }),
        ]);

        const questionJson = await questionRes.json().catch(() => ({ questions: [] }));

        if (!questionRes.ok) {
          throw new Error(questionJson.error ?? 'Failed to load assessment questions')
        }

        setLevelMeta({
          levelNum: levelRes.data?.level_order ?? 1,
          label: levelRes.data?.level_name ?? t('common.levelLabel').replace('{{number}}', ''),
        });

        setQuestions(questionJson.questions ?? []);
        setLoadError(null);
      } catch (error) {
        console.error('[assessment chapter] failed to load assessment data:', error)
        setLoadError(error instanceof Error ? error.message : 'Failed to load assessment')
      } finally {
        setLoading(false)
      }
    }
    init();
  }, [chapterId, router, t]);

  if (loading) {
    return (
      <div className="min-h-dvh overflow-y-auto overflow-x-hidden flex items-center justify-center bg-white" style={{ WebkitOverflowScrolling: 'touch' }}>
        <p className="text-[#7B3F00] font-bold text-lg animate-pulse">{t('common.loading')}</p>
      </div>
    );
  }

  if (!levelMeta) {
    return (
      <div className="h-[100dvh] overflow-hidden flex items-center justify-center bg-white px-6">
        <p className="text-[#7B3F00] font-semibold text-center">{t('assessmentPage.chapterNotFound')}</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-dvh overflow-y-auto overflow-x-hidden flex flex-col items-center justify-center bg-white px-6 gap-4" style={{ WebkitOverflowScrolling: 'touch' }}>
        <p className="text-[#B91C1C] font-bold text-center">{loadError}</p>
        <button
          onClick={() => router.replace('/dashboard/assessment')}
          className="mt-2 bg-[#E8A87C] border-[3px] border-[#E8A87C] text-white font-black px-8 py-2 rounded-full shadow-md hover:scale-105 transition-transform"
        >
          {t('common.goBack')}
        </button>
      </div>
    )
  }

  if (questions.length === 0) {
    return (
      <div className="min-h-dvh overflow-y-auto overflow-x-hidden flex flex-col items-center justify-center bg-white px-6 gap-4" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="w-20 h-20 rounded-full bg-amber-100 border-4 border-amber-400 flex items-center justify-center text-4xl">
          🚧
        </div>
        <p className="text-[#7B3F00] font-black text-xl text-center">{t('common.underDevelopment')}</p>
        <p className="text-[#7B3F00] font-medium text-sm text-center">
          {t('assessmentPage.noQuestionsForChapter')}
        </p>
        <button
          onClick={() => router.replace('/dashboard/assessment')}
          className="mt-2 bg-[#E8A87C] border-[3px] border-[#E8A87C] text-white font-black px-8 py-2 rounded-full shadow-md hover:scale-105 transition-transform"
        >
          {t('common.goBack')}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-dvh overflow-x-hidden overflow-y-auto bg-white px-4 sm:px-6 pt-2 sm:pt-3 pb-3 sm:pb-4 flex flex-col" style={{ WebkitOverflowScrolling: 'touch' }}>

      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-2 sm:mb-3 shrink-0">
        <button
          onClick={() => router.replace('/dashboard/assessment')}
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
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)', e.currentTarget.style.boxShadow = '0 6px 0 #b86a00, 0 8px 16px rgba(0, 0, 0, 0.3)')}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'translateY(4px) scale(0.96)', e.currentTarget.style.boxShadow = '0 2px 0 #b86a00, 0 4px 8px rgba(0, 0, 0, 0.2)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1.1)', e.currentTarget.style.boxShadow = '0 6px 0 #b86a00, 0 8px 16px rgba(0, 0, 0, 0.3)')}
          aria-label={t('assessmentPage.backToAssessmentList')}
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>

        <div aria-hidden className="w-[clamp(36px,6vw,44px)]" />

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

      {/* ── Assessment view ───────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-visible">
        <AssessmentView
          levelNum={levelMeta.levelNum}
          levelLabel={levelMeta.label}
          chapterId={chapterId}
          questions={questions}
          showTimer={settings.showTimer}
          timerLabel={timerLabel}
          onFinish={handleAssessmentFinish}
        />
      </div>

      {showCompleteModal && (
        <LessonCompleteModal
          mode="assessment"
          levelNumber={levelMeta.levelNum}
          onReplay={() => {
            setShowCompleteModal(false);
            router.refresh();
          }}
          onClose={() => router.replace('/dashboard/lessons')}
          onNext={() => router.replace('/dashboard/lessons')}
        />
      )}

    </div>
  );
}
