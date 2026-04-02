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
import GearIcon from '@/public/images/svgs/gear-icon.svg';
import SettingsModal from '@/components/settings/SettingsModal';
import { useSettings } from '@/hooks/useSettings';
import { useLanguage } from '@/hooks/useLanguage';

interface LevelMeta {
  levelNum: number;
  label:    string;
}

export default function AssessmentChapterPage() {
  const router            = useRouter();
  const { chapterId }     = useParams<{ chapterId: string }>();
  const { t } = useLanguage();
  const { settings, updateSetting } = useSettings();

  const [levelMeta,     setLevelMeta]     = useState<LevelMeta | null>(null);
  const [hasQuestions,  setHasQuestions]  = useState(false);
  const [loading,       setLoading]       = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/'); return; }

      const [levelRes, questionsRes] = await Promise.all([
        supabase
          .from('levels')
          .select('level_name, level_order')
          .eq('level_id', chapterId)
          .single(),
        supabase
          .from('assessment_questions')
          .select('question_id', { count: 'exact', head: true })
          .eq('level_id', chapterId),
      ]);

      setLevelMeta({
        levelNum: levelRes.data?.level_order ?? 1,
        label:    levelRes.data?.level_name  ?? t('common.levelLabel').replace('{{number}}', ''),
      });
      setHasQuestions((questionsRes.count ?? 0) > 0);
      setLoading(false);
    }
    init();
  }, [chapterId, router, t]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p className="text-[#7B3F00] font-bold text-lg animate-pulse">{t('common.loading')}</p>
      </div>
    );
  }

  if (!levelMeta) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <p className="text-[#7B3F00] font-semibold text-center">{t('assessmentPage.chapterNotFound')}</p>
      </div>
    );
  }

  if (!hasQuestions) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6 gap-4">
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
    <div className="min-h-screen bg-white px-6 pt-5 pb-12">

      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
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

        {settings.showTimer && (
          <p className="text-[#7B3F00] font-black text-sm sm:text-base">{timerLabel}</p>
        )}

        <button
          onClick={() => setShowSettings(true)}
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

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        updateSetting={updateSetting}
      />

      {/* ── Assessment view ───────────────────────────────────────── */}
      <AssessmentView
        levelNum={levelMeta.levelNum}
        levelLabel={levelMeta.label}
        confirmSubmit={settings.confirmSubmit}
        reviewBeforeSubmit={settings.reviewBeforeSubmit}
        onFinish={() => router.replace('/dashboard/assessment')}
      />

    </div>
  );
}
