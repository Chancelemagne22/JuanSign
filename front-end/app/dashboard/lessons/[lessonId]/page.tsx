'use client';

// PAGE: Module Controller
// ROUTE: /dashboard/lessons/[lessonId]
//
// Orchestrates the 3-step learning cycle for each letter in a level:
//   LessonView (watch video) → PracticeView (record sign) → repeat per letter → AssessmentView
//
// State machine:
//   letterIndex : which letter we're currently on (0-based)
//   step        : 'lesson' | 'practice' | 'assessment'
//
// Transitions:
//   handleNextFromLesson()   → step = 'practice'
//   handleNextFromPractice() → letterIndex++ + step = 'lesson'   (if more letters remain)
//                           → step = 'assessment'                 (after last letter)

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import GearIcon from '@/public/images/svgs/gear-icon.svg';
import LessonView from '@/components/module/LessonView';
import PracticeView from '@/components/module/PracticeView';
import AssessmentView from '@/components/module/AssessmentView';

// ── Mock level data (used while Supabase has no real levels) ────────────────
// Remove this map and the mock branch in init() once levels are seeded in Supabase.
const MOCK_LEVEL_DATA: Record<string, {
  levelNum: number;
  label:    string;
  letters:  { label: string; videoUrl: string | null }[];
}> = {
  'mock-1': { levelNum: 1, label: 'Alphabets (A to E)',     letters: ['A','B','C','D','E'].map(l => ({ label: l, videoUrl: null })) },
  'mock-2': { levelNum: 2, label: 'Alphabets (F to J)',     letters: ['F','G','H','I','J'].map(l => ({ label: l, videoUrl: null })) },
  'mock-3': { levelNum: 3, label: 'Alphabets (K to O)',     letters: ['K','L','M','N','O'].map(l => ({ label: l, videoUrl: null })) },
  'mock-4': { levelNum: 4, label: 'Alphabets (P to T)',     letters: ['P','Q','R','S','T'].map(l => ({ label: l, videoUrl: null })) },
  'mock-5': { levelNum: 5, label: 'Alphabets (U to Y)',     letters: ['U','V','W','X','Y'].map(l => ({ label: l, videoUrl: null })) },
  'mock-6': { levelNum: 6, label: 'Alphabets (Z, Ñ, NG)',   letters: ['Z','Ñ','NG'].map(l => ({ label: l, videoUrl: null })) },
  'mock-7': { levelNum: 7, label: 'Numbers (0 to 9)',        letters: ['0','1','2','3','4','5','6','7','8','9'].map(l => ({ label: l, videoUrl: null })) },
  'mock-8': { levelNum: 8, label: 'Common Phrases',          letters: ['Good morning','Thank you','How are you?','My name is…','I love you','Please help me'].map(l => ({ label: l, videoUrl: null })) },
};

type ModuleStep = 'lesson' | 'practice' | 'assessment';

interface LetterUnit {
  label:    string;
  videoUrl: string | null;
}

interface LevelMeta {
  levelNum: number;
  label:    string;
}

// Per-step heading content
const STEP_HEADINGS: Record<ModuleStep, {
  title:      string;
  subtitle:   string;
  titleColor: string;
  stroke?:    string;
  shadow?:    string;
}> = {
  lesson: {
    title:      "Let's learn FSL!",
    subtitle:   'Build your FSL skills one lesson at a time',
    titleColor: '#2E7D1C',
    stroke:     '1.5px #1a4d10',
    shadow:     '2px 2px 0 #1a4d10',
  },
  practice: {
    title:      "LET'S PRACTICE!",
    subtitle:   "Let's test what you've learned",
    titleColor: '#CC2200',
  },
  assessment: {
    title:      'Assessment',
    subtitle:   'Show what you know!',
    titleColor: '#7B3F00',
    stroke:     '1.5px #5D3A1A',
    shadow:     '2px 2px 0 #5D3A1A',
  },
};

export default function ModulePage() {
  const router             = useRouter();
  const { lessonId }       = useParams<{ lessonId: string }>();

  const [letters,     setLetters]     = useState<LetterUnit[]>([]);
  const [levelMeta,   setLevelMeta]   = useState<LevelMeta | null>(null);
  const [letterIndex, setLetterIndex] = useState(0);
  const [step,        setStep]        = useState<ModuleStep>('lesson');
  const [loading,     setLoading]     = useState(true);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/'); return; }

      // ── Mock path ────────────────────────────────────────────────────────
      const mock = MOCK_LEVEL_DATA[lessonId];
      if (mock) {
        setLevelMeta({ levelNum: mock.levelNum, label: mock.label });
        setLetters(mock.letters);
        setLoading(false);
        return;
      }

      // ── Supabase path ────────────────────────────────────────────────────
      // Verify the level is unlocked for this user before loading content.
      const [progressRes, levelRes, lessonsRes] = await Promise.all([
        supabase
          .from('user_progress')
          .select('is_unlocked')
          .eq('auth_user_id', user.id)
          .eq('level_id', lessonId)
          .single(),
        supabase
          .from('levels')
          .select('name, level_order')
          .eq('id', lessonId)
          .single(),
        // Each lesson row in this level = one letter/sign unit in the cycle.
        // The `title` field is the letter label (e.g. "A"), `video_url` is the demo clip.
        supabase
          .from('lessons')
          .select('id, title, video_url, order_index')
          .eq('level_id', lessonId)
          .order('order_index'),
      ]);

      if (!progressRes.data?.is_unlocked) {
        router.replace('/dashboard');
        return;
      }

      const lessonRows = lessonsRes.data ?? [];
      setLetters(lessonRows.map((r) => ({ label: r.title, videoUrl: r.video_url })));
      setLevelMeta({
        levelNum: levelRes.data?.level_order ?? 1,
        label:    levelRes.data?.name        ?? 'Chapter',
      });
      setLoading(false);
    }

    init();
  }, [lessonId, router]);

  /* ── State machine transitions ────────────────────────────────────────── */
  function handleNextFromLesson() {
    setStep('practice');
  }

  function handleNextFromPractice() {
    if (letterIndex < letters.length - 1) {
      setLetterIndex((i) => i + 1);
      setStep('lesson');
    } else {
      setStep('assessment');
    }
  }

  /* ── Loading / empty guards ───────────────────────────────────────────── */
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
          No content available for this level yet.
        </p>
      </div>
    );
  }

  const currentLetter = letters[letterIndex];
  const heading       = STEP_HEADINGS[step];

  return (
    <div className="min-h-screen bg-white px-6 pt-5 pb-12">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => router.replace('/dashboard')}
          className="w-11 h-11 rounded-full bg-[#E8A87C] border-[3px] border-[#BF7B45] flex items-center justify-center shadow-md hover:scale-105 transition-transform"
          aria-label="Back to dashboard"
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

      {/* ── Page heading ─────────────────────────────────────────────────── */}
      <div className="text-center mb-5">
        <h1
          className="font-black text-[2rem] leading-tight"
          style={{
            fontFamily:       'var(--font-baloo)',
            color:            heading.titleColor,
            WebkitTextStroke: heading.stroke,
            textShadow:       heading.shadow,
          }}
        >
          {heading.title}
        </h1>
        <p className="text-[#4A2C0A] font-bold text-sm mt-1">{heading.subtitle}</p>
      </div>

      {/* ── Module content ────────────────────────────────────────────────── */}
      {step === 'lesson' && (
        <LessonView
          letter={currentLetter.label}
          videoUrl={currentLetter.videoUrl}
          levelNum={levelMeta.levelNum}
          levelLabel={levelMeta.label}
          onNext={handleNextFromLesson}
        />
      )}

      {step === 'practice' && (
        <PracticeView
          letter={currentLetter.label}
          letterIndex={letterIndex}
          totalLetters={letters.length}
          onNext={handleNextFromPractice}
        />
      )}

      {step === 'assessment' && (
        <AssessmentView
          levelNum={levelMeta.levelNum}
          levelLabel={levelMeta.label}
          onFinish={() => router.replace('/dashboard')}
        />
      )}

    </div>
  );
}
