'use client';

// PAGE: Practice Chapter
// ROUTE: /dashboard/practice/[chapterId]
//
// Cycles through each letter/sign in the chapter using PracticeView (webcam recording).
// Each letter's ML accuracy is collected via onResult(); the average is stored
// in practice_sessions when the chapter is finished.

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import PracticeView from '@/components/module/PracticeView';

interface LetterUnit {
  label: string;
}

interface LevelMeta {
  levelNum: number;
  label:    string;
}

export default function PracticeChapterPage() {
  const router              = useRouter();
  const { chapterId }       = useParams<{ chapterId: string }>();

  const [letters,     setLetters]     = useState<LetterUnit[]>([]);
  const [levelMeta,   setLevelMeta]   = useState<LevelMeta | null>(null);
  const [letterIndex, setLetterIndex] = useState(0);
  const [loading,     setLoading]     = useState(true);

  // Collect per-letter accuracy scores returned by Modal
  const accuracyScores = useRef<number[]>([]);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/'); return; }

      const [levelRes, lessonsRes] = await Promise.all([
        supabase
          .from('levels')
          .select('level_name, level_order')
          .eq('level_id', chapterId)
          .single(),
        supabase
          .from('lessons')
          .select('lesson_title, lesson_order')
          .eq('level_id', chapterId)
          .order('lesson_order'),
      ]);

      setLetters((lessonsRes.data ?? []).map((r) => ({ label: r.lesson_title })));
      setLevelMeta({
        levelNum: levelRes.data?.level_order ?? 1,
        label:    levelRes.data?.level_name      ?? 'Chapter',
      });
      setLoading(false);
    }
    init();
  }, [chapterId, router]);

  function handleResult(accuracy: number) {
    accuracyScores.current.push(accuracy);
  }

  async function handleNext() {
    if (letterIndex < letters.length - 1) {
      setLetterIndex((i) => i + 1);
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

  if (!levelMeta || letters.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <p className="text-[#7B3F00] font-semibold text-center">
          No practice questions available for this chapter yet.
        </p>
      </div>
    );
  }

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
          {letterIndex + 1} / {letters.length}
        </p>
      </div>

      {/* ── Page heading ─────────────────────────────────────────── */}
      <div className="text-center mb-4 shrink-0">
        <h1
          className="font-black text-[2rem] leading-tight"
          style={{
            fontFamily: 'var(--font-baloo)',
            color:      '#CC2200',
          }}
        >
          LET&apos;S PRACTICE!
        </h1>
        <p className="text-[#4A2C0A] font-bold text-sm mt-1">
          <span className="font-black">Chapter {levelMeta.levelNum}</span>
          {'  '}
          <span className="font-semibold">{levelMeta.label}</span>
        </p>
      </div>

      {/* ── Practice view — fills remaining height ────────────────── */}
      <div className="flex-1 min-h-0">
        <PracticeView
          letter={letters[letterIndex].label}
          letterIndex={letterIndex}
          totalLetters={letters.length}
          levelId={chapterId}
          onNext={handleNext}
          onResult={handleResult}
        />
      </div>

    </div>
  );
}
