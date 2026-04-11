'use client';

// PAGE: Lesson Viewer (Video Only)
// ROUTE: /dashboard/lessons/[lessonId]
//
// Cycles through each letter/sign video in the chapter.
// On completing the last video:
//   - Updates user_progress.lessons_completed for this level
//   - Unlocks the next level (sets is_unlocked = true on the next level's user_progress row)
//   - Navigates back to /dashboard/lessons

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import LessonPanelView from '@/components/module/LessonPanelView';
import LessonCompleteModal from '@/components/module/LessonCompleteModal';
import GearIcon from '@/public/images/svgs/gear-icon.svg';
import { useSettings, useSettingsModal } from '@/hooks/useSettings';
import { useLanguage } from '@/hooks/useLanguage';

interface LetterUnit {
  label:       string;
  videoUrl:    string | null;
  contextText: string | null;
}

interface LevelMeta {
  levelNum: number;
  label:    string;
}

export default function LessonPage() {
  const router             = useRouter();
  const { lessonId }       = useParams<{ lessonId: string }>();
  const { t } = useLanguage();
  const { settings } = useSettings();
  const { openSettings } = useSettingsModal();

  const [letters,     setLetters]     = useState<LetterUnit[]>([]);
  const [levelMeta,   setLevelMeta]   = useState<LevelMeta | null>(null);
  const [letterIndex, setLetterIndex] = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [showCompleteModal, setShowCompleteModal] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.replace('/'); return; }

        if (!lessonId) {
          router.replace('/dashboard/lessons');
          return;
        }

        const [progressRes, levelRes, lessonsRes] = await Promise.all([
          supabase
            .from('user_progress')
            .select('is_unlocked')
            .eq('auth_user_id', user.id)
            .eq('level_id', lessonId)
            .single(),
          supabase
            .from('levels')
            .select('level_name, level_order')
            .eq('level_id', lessonId)
            .single(),
          supabase
            .from('lessons')
            .select('lesson_id, lesson_title, video_url, content_text, lesson_order')
            .eq('level_id', lessonId)
            .order('lesson_order'),
        ]);

        if (progressRes.error || !progressRes.data?.is_unlocked) {
          router.replace('/dashboard/lessons');
          return;
        }

        if (levelRes.error || !levelRes.data) {
          router.replace('/dashboard/lessons');
          return;
        }

        if (lessonsRes.error || !lessonsRes.data || lessonsRes.data.length === 0) {
          router.replace('/dashboard/lessons');
          return;
        }

        setLetters((lessonsRes.data ?? []).map((r) => ({ label: r.lesson_title, videoUrl: r.video_url, contextText: r.content_text })));
        setLevelMeta({
          levelNum: levelRes.data?.level_order ?? 1,
          label:    levelRes.data?.level_name ?? t('common.chapterLabel').replace('{{number}}', ''),
        });
        setLoading(false);
      } catch (error) {
        console.error('[lessons page] failed to load lesson data:', error);
        router.replace('/dashboard/lessons');
      }
    }
    init();
  }, [lessonId, router, t]);

  async function handleNext() {
    if (letterIndex < letters.length - 1) {
      // Advance to next letter
      setLetterIndex((i) => i + 1);
    } else {
      // Last letter finished — mark lesson complete and unlock next level
      await completeLesson();
      setShowCompleteModal(true);
    }
  }

  async function handlePrevious() {
    if (letterIndex > 0) {
      // Go back to previous letter
      setLetterIndex((i) => i - 1);
    }
  }

  async function completeLesson() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;


    // Mark lessons_completed for this level
    await supabase
      .from('user_progress')
      .update({ lessons_completed: letters.length })
      .eq('auth_user_id', user.id)
      .eq('level_id', lessonId);
    // Unlock the next level (find level where previous_level_id = lessonId)
    const { data: nextLevel } = await supabase
      .from('levels')
      .select('level_id')
      .eq('previous_level_id', lessonId)
      .single();

    if (nextLevel) {
      // upsert: creates the row if it doesn't exist yet, updates it if it does.
      // .update() would silently do nothing when the row is missing.
      await supabase
        .from('user_progress')
        .upsert(
          { auth_user_id: user.id, level_id: nextLevel.level_id, is_unlocked: true },
          { onConflict: 'auth_user_id,level_id' },
        );
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p className="text-[#7B3F00] font-bold text-lg animate-pulse">{t('common.loading')}</p>
      </div>
    );
  }

  if (!levelMeta || letters.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <p className="text-[#7B3F00] font-semibold text-center">
          {t('common.noVideosForChapter')}
        </p>
      </div>
    );
  }

  const currentLetter = letters[letterIndex];
  const isLast        = letterIndex === letters.length - 1;

  return (
    <>
    <div className="min-h-dvh overflow-x-hidden overflow-y-auto xl:h-dvh xl:overflow-hidden bg-white px-4 sm:px-6 pt-4 sm:pt-5 pb-4 sm:pb-5 flex flex-col">

      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <button
          onClick={() => router.replace('/dashboard/lessons')}
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
          aria-label={t('lessonsPage.backToLessons')}
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>

        {/* Letter progress indicator */}
        <p className="text-[#4A2C0A] font-bold text-base sm:text-lg">
          {letterIndex + 1} / {letters.length}
        </p>

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

      {/* ── Page heading ─────────────────────────────────────────── */}
      <div className="text-center mb-2 shrink-0">
        <h1
          className="font-black leading-tight text-[2rem] sm:text-[2.35rem]"
          style={{
            fontFamily:       'var(--font-spicy-rice)',
            color:            '#2E7D1C',
          }}
        >
          {t('lessonsPage.letsLearn')}
        </h1>
        {settings.showCaptions && (
          <p className="text-[#4A2C0A] font-bold text-base sm:text-lg mt-0.5">
            {t('lessonsPage.buildSkills')}
          </p>
        )}
      </div>

      {/* ── Lesson video and context panel — fills remaining height ─────────────────── */}
      <div className="flex-1 min-h-0 overflow-visible">
        <LessonPanelView
          letter={currentLetter.label}
          videoUrl={currentLetter.videoUrl}
          contextText={currentLetter.contextText}
          levelNum={levelMeta.levelNum}
          levelLabel={levelMeta.label}
          currentIndex={letterIndex}
          totalLessons={letters.length}
          onNext={handleNext}
          onPrevious={handlePrevious}
          autoplayNext={settings.autoplayLesson}
          playbackSpeed={settings.playbackSpeed}
          showCaptions={settings.showCaptions}
          nextLabel={isLast ? t('module.finish') : undefined}
        />
      </div>

    </div>
    {showCompleteModal && levelMeta && (
      <LessonCompleteModal
        mode="lesson"
        levelNumber={levelMeta.levelNum}
        onReplay={() => {
          setLetterIndex(0);
          setShowCompleteModal(false);
        }}
        onNext={() => router.replace(`/dashboard/practice/${lessonId}`)}
        onClose={() => router.replace('/dashboard/lessons')}
      />
    )}
    </>
  );
}


