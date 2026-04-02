'use client';

// PAGE: Practice Chapter
// ROUTE: /dashboard/practice/[chapterId]
//
// Cycles through all practice_questions for the chapter.
//   - "identify" type → IdentifyView (multiple choice, no timer)
//   - "perform"  type → PracticeView (webcam, no timer)
// Average accuracy is stored in practice_sessions when the chapter is finished.

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import PracticeView  from '@/components/module/PracticeView';
import IdentifyView  from '@/components/module/IdentifyView';
import GearIcon from '@/public/images/svgs/gear-icon.svg';
import SettingsModal from '@/components/settings/SettingsModal';
import { useSettings } from '@/hooks/useSettings';
import { useLanguage } from '@/hooks/useLanguage';

interface QuestionUnit {
  id:            string;
  type:          'identify' | 'perform';
  // perform
  targetSign:    string;
  // identify
  questionText:  string;
  videoUrl:      string | null;
  optionA:       string;
  optionB:       string;
  optionC:       string;
  optionD:       string;
  correctAnswer: string;
}

interface LevelMeta {
  levelNum: number;
  label:    string;
}

export default function PracticeChapterPage() {
  const router          = useRouter();
  const { chapterId }   = useParams<{ chapterId: string }>();
  const { t } = useLanguage();
  const { settings, updateSetting } = useSettings();

  const [rawQuestions, setRawQuestions] = useState<QuestionUnit[]>([]);
  const [questions,    setQuestions]    = useState<QuestionUnit[]>([]);
  const [levelMeta,    setLevelMeta]    = useState<LevelMeta | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const accuracyScores = useRef<number[]>([]);
  const activeQuestionIdRef = useRef<string | null>(null);

  function shuffleQuestions(items: QuestionUnit[]) {
    const next = [...items];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
  }

  useEffect(() => {
    activeQuestionIdRef.current = questions[currentIndex]?.id ?? null;
  }, [questions, currentIndex]);

  useEffect(() => {
    if (rawQuestions.length === 0) {
      setQuestions([]);
      return;
    }

    const nextQuestions = settings.shuffleQuestions
      ? shuffleQuestions(rawQuestions)
      : rawQuestions;

    setQuestions(nextQuestions);

    const activeId = activeQuestionIdRef.current;
    if (!activeId) {
      setCurrentIndex(0);
      return;
    }

    const nextIndex = nextQuestions.findIndex((q) => q.id === activeId);
    setCurrentIndex(nextIndex >= 0 ? nextIndex : 0);
  }, [rawQuestions, settings.shuffleQuestions]);

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
          .from('practice_questions')
          .select('question_id, question_type, question_text, video_url, option_a, option_b, option_c, option_d, correct_answer, target_sign')
          .eq('level_id', chapterId)
          .order('created_at'),
      ]);

      const fetchedQuestions = (questionsRes.data ?? []).map((r) => ({
          id:            r.question_id,
          type:          r.question_type as 'identify' | 'perform',
          targetSign:    r.target_sign   ?? '',
          questionText:  r.question_text ?? '',
          videoUrl:      r.video_url     ?? null,
          optionA:       r.option_a      ?? '',
          optionB:       r.option_b      ?? '',
          optionC:       r.option_c      ?? '',
          optionD:       r.option_d      ?? '',
          correctAnswer: r.correct_answer ?? '',
        }));

      setRawQuestions(fetchedQuestions);
      setLevelMeta({
        levelNum: levelRes.data?.level_order ?? 1,
        label:    levelRes.data?.level_name  ?? t('common.levelLabel').replace('{{number}}', ''),
      });
      setLoading(false);
    }
    init();
  }, [chapterId, router, t]);

  function handleResult(accuracy: number) {
    accuracyScores.current.push(accuracy);
  }

  async function handleNext(accuracy?: number) {
    if (accuracy !== undefined) accuracyScores.current.push(accuracy);

    if (currentIndex < questions.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      await completePractice();
      router.replace('/dashboard/practice');
    }
  }

  async function completePractice() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const scores = accuracyScores.current;
    const avgAccuracy = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;

    await supabase.from('practice_sessions').insert({
      auth_user_id:     user.id,
      level_id:         chapterId,
      average_accuracy: avgAccuracy,
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p className="text-[#7B3F00] font-bold text-lg animate-pulse">{t('common.loading')}</p>
      </div>
    );
  }

  if (!levelMeta || questions.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6 gap-4">
        <div className="w-20 h-20 rounded-full bg-amber-100 border-4 border-amber-400 flex items-center justify-center text-4xl">
          🚧
        </div>
        <p className="text-[#7B3F00] font-black text-xl text-center">{t('common.underDevelopment')}</p>
        <p className="text-[#7B3F00] font-medium text-sm text-center">
          {t('practicePage.noQuestionsForChapter')}
        </p>
        <button
          onClick={() => router.replace('/dashboard/practice')}
          className="mt-2 bg-[#E8A87C] border-[3px] border-[#E8A87C] text-white font-black px-8 py-2 rounded-full shadow-md hover:scale-105 transition-transform"
        >
          {t('common.goBack')}
        </button>
      </div>
    );
  }

  const current = questions[currentIndex];

  return (
    <div className="h-screen overflow-hidden bg-white px-4 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 flex flex-col">

      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div className="relative z-20 flex items-center justify-start mb-3 sm:mb-4 shrink-0">
        <button
          onClick={() => router.replace('/dashboard/practice')}
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
          aria-label={t('practicePage.backToPractice')}
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>

        <button
          onClick={() => setShowSettings(true)}
          className="ml-auto flex items-center justify-center flex-shrink-0 transition-transform"
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

      {/* ── Page heading ─────────────────────────────────────────── */}
      <div className="relative z-20 text-center mb-3 sm:mb-4 shrink-0">
        <h1
          className="font-black text-[2rem] leading-tight"
          style={{ fontFamily: 'var(--font-baloo)', color: '#CC2200' }}
        >
          {t('practicePage.letsPractice')}
        </h1>
        <p className="text-[#4A2C0A] font-bold text-sm mt-1">
          <span className="font-black">{t('common.levelLabel').replace('{{number}}', String(levelMeta.levelNum))}</span>
          {'  '}
          <span className="font-semibold">{levelMeta.label}</span>
        </p>
      </div>

      {/* ── Question view — fills remaining height ────────────────── */}
      <div className="relative z-10 flex-1 min-h-0 overflow-hidden pt-1 sm:pt-2">
        {current.type === 'perform' ? (
          <PracticeView
            key={current.id}
            letter={current.targetSign || current.questionText}
            letterIndex={currentIndex}
            totalLetters={questions.length}
            levelId={chapterId}
            onNext={() => handleNext()}
            onResult={handleResult}
          />
        ) : (
          <IdentifyView
            key={current.id}
            questionText={current.questionText}
            videoUrl={current.videoUrl}
            optionA={current.optionA}
            optionB={current.optionB}
            optionC={current.optionC}
            optionD={current.optionD}
            correctAnswer={current.correctAnswer}
            questionIndex={currentIndex}
            totalQuestions={questions.length}
            sideBySide
            showCorrectAnswerAfterSubmit={settings.showCorrectAnswer}
            soundEffects={settings.soundEffects}
            onNext={(accuracy) => handleNext(accuracy)}
          />
        )}
      </div>

    </div>
  );
}
