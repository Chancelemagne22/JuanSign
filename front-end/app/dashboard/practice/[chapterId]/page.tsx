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
import { supabase } from '@/lib/supabase';
import PracticeView  from '@/components/module/PracticeView';
import IdentifyView  from '@/components/module/IdentifyView';

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

  const [questions,    setQuestions]    = useState<QuestionUnit[]>([]);
  const [levelMeta,    setLevelMeta]    = useState<LevelMeta | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading,      setLoading]      = useState(true);

  const accuracyScores = useRef<number[]>([]);

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

      setQuestions(
        (questionsRes.data ?? []).map((r) => ({
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
        }))
      );
      setLevelMeta({
        levelNum: levelRes.data?.level_order ?? 1,
        label:    levelRes.data?.level_name  ?? 'Chapter',
      });
      setLoading(false);
    }
    init();
  }, [chapterId, router]);

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
        <p className="text-[#7B3F00] font-bold text-lg animate-pulse">Loading…</p>
      </div>
    );
  }

  if (!levelMeta || questions.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6 gap-4">
        <div className="w-20 h-20 rounded-full bg-amber-100 border-4 border-amber-400 flex items-center justify-center text-4xl">
          🚧
        </div>
        <p className="text-[#7B3F00] font-black text-xl text-center">Under Development</p>
        <p className="text-[#7B3F00] font-medium text-sm text-center">
          No practice questions have been added for this chapter yet.
        </p>
        <button
          onClick={() => router.replace('/dashboard/practice')}
          className="mt-2 bg-[#E8A87C] border-[3px] border-[#BF7B45] text-white font-black px-8 py-2 rounded-full shadow-md hover:scale-105 transition-transform"
        >
          Go Back
        </button>
      </div>
    );
  }

  const current = questions[currentIndex];

  return (
    <div className="h-screen overflow-hidden bg-white px-6 pt-5 pb-6 flex flex-col">

      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <button
          onClick={() => router.replace('/dashboard/practice')}
          className="w-11 h-11 rounded-full bg-[#E8A87C] border-[3px] border-[#BF7B45] flex items-center justify-center shadow-md hover:scale-105 transition-transform"
          aria-label="Back to practice"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>

        <p className="text-[#4A2C0A] font-bold text-sm">
          {currentIndex + 1} / {questions.length}
        </p>
      </div>

      {/* ── Page heading ─────────────────────────────────────────── */}
      <div className="text-center mb-4 shrink-0">
        <h1
          className="font-black text-[2rem] leading-tight"
          style={{ fontFamily: 'var(--font-baloo)', color: '#CC2200' }}
        >
          LET&apos;S PRACTICE!
        </h1>
        <p className="text-[#4A2C0A] font-bold text-sm mt-1">
          <span className="font-black">Chapter {levelMeta.levelNum}</span>
          {'  '}
          <span className="font-semibold">{levelMeta.label}</span>
        </p>
      </div>

      {/* ── Question view — fills remaining height ────────────────── */}
      <div className="flex-1 min-h-0">
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
            onNext={(accuracy) => handleNext(accuracy)}
          />
        )}
      </div>

    </div>
  );
}
