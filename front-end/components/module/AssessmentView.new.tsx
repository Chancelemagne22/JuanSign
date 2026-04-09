'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { supabase } from '@/lib/supabase';
import PracticeView from '@/components/module/PracticeView';
import IdentifyView from '@/components/module/IdentifyView';

// COMPONENT: AssessmentView
// Full implementation:
//   - Fetch assessment_questions for this level from Supabase.
//   - Present each question to the user (webcam recording per question).
//   - Send each clip to Modal endpoint and receive { sign, confidence }.
//   - Score the attempt, calculate stars_earned (0–3) based on accuracy.
//   - INSERT result into `assessment_results` (score, stars_earned, time_taken_seconds, is_passed).
//   - Show final score screen with stars and a "Back to Dashboard" button.
//   - On pass: update `user_progress` to unlock the next level.

interface AssessmentQuestion {
  id: string;
  type: 'identify' | 'perform';
  questionText: string;
  videoUrl: string | null;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: string;
  correctSign: string;
  points: number;
}

interface Props {
  levelNum: number;
  levelLabel: string;
  chapterId: string;
  onFinish: () => void;
  confirmSubmit?: boolean;
  reviewBeforeSubmit?: boolean;
}

export default function AssessmentView({
  levelNum,
  levelLabel,
  chapterId,
  onFinish,
  confirmSubmit = true,
  reviewBeforeSubmit = true,
}: Props) {
  const { t } = useLanguage();
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isCompleted, setIsCompleted] = useState(false);
  const [score, setScore] = useState(0);
  const [starsEarned, setStarsEarned] = useState(0);
  const [showReviewPrompt, setShowReviewPrompt] = useState(false);

  const scoresRef = useRef<number[]>([]);
  const startTimeRef = useRef<number>(Date.now());

  // Fetch and shuffle questions
  useEffect(() => {
    async function init() {
      try {
        const { data, error } = await supabase
          .from('assessment_questions')
          .select('question_id, question_type, question_text, video_url, option_a, option_b, option_c, option_d, correct_answer, correct_sign, points')
          .eq('level_id', chapterId)
          .order('created_at');

        if (error) throw error;

        const fetchedQuestions = (data ?? []).map((q) => ({
          id: q.question_id,
          type: q.question_type as 'identify' | 'perform',
          questionText: q.question_text ?? '',
          videoUrl: q.video_url ?? null,
          optionA: q.option_a ?? '',
          optionB: q.option_b ?? '',
          optionC: q.option_c ?? '',
          optionD: q.option_d ?? '',
          correctAnswer: q.correct_answer ?? '',
          correctSign: q.correct_sign ?? '',
          points: q.points ?? 0,
        }));

        // Shuffle questions randomly
        const shuffled = [...fetchedQuestions].sort(() => Math.random() - 0.5);
        console.log('[AssessmentView] Questions loaded and shuffled randomly:', shuffled.map(q => q.id));
        console.log('[AssessmentView] Shuffle enabled: true (Questions will be different each attempt)');
        
        setQuestions(shuffled);
      } catch (error) {
        console.error('[AssessmentView] Error loading questions:', error);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [chapterId]);

  function handleResult(accuracy: number) {
    scoresRef.current.push(accuracy);
    console.log('[AssessmentView] Question answered with accuracy:', accuracy);
  }

  function handleNext(accuracy?: number) {
    if (accuracy !== undefined) scoresRef.current.push(accuracy);

    if (currentIndex < questions.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      void completeAssessment();
    }
  }

  async function completeAssessment() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const scores = scoresRef.current;
    const totalScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) : 0;
    const avgScore = scores.length > 0 ? totalScore / scores.length : 0;
    const timeTaken = Math.round((Date.now() - startTimeRef.current) / 1000);
    const stars = avgScore >= 0.8 ? 3 : avgScore >= 0.6 ? 2 : avgScore >= 0.4 ? 1 : 0;
    const passed = avgScore >= 0.6;

    console.log('[AssessmentView] Assessment completed:', {
      totalScore,
      averageScore: avgScore,
      timeTaken,
      stars,
      passed,
      questionsOrder: questions.map(q => q.id),
      questionsWereShuffled: true,
    });

    // Insert result into assessment_results
    await supabase.from('assessment_results').insert({
      auth_user_id: user.id,
      level_id: chapterId,
      score: Math.round(avgScore * 100),
      stars_earned: stars,
      time_taken_seconds: timeTaken,
      is_passed: passed,
    });

    // If passed, unlock next level
    if (passed) {
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

    setScore(Math.round(avgScore * 100));
    setStarsEarned(stars);
    setIsCompleted(true);
  }

  function finalizeSubmit() {
    if (confirmSubmit && !window.confirm(t('assessmentView.submitConfirm'))) return;
    onFinish();
  }

  function handleFinishClick() {
    if (reviewBeforeSubmit) {
      setShowReviewPrompt(true);
      return;
    }
    finalizeSubmit();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-[#7B3F00] font-bold text-lg animate-pulse">{t('common.loading')}</p>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-12 px-4 text-center">
        <div className="w-20 h-20 rounded-full bg-amber-100 border-4 border-amber-400 flex items-center justify-center text-4xl">
          🚧
        </div>
        <p className="text-[#7B3F00] font-black text-xl">{t('common.underDevelopment')}</p>
        <p className="text-[#7B3F00] font-medium text-sm">{t('assessmentPage.noQuestionsForChapter')}</p>
      </div>
    );
  }

  if (isCompleted) {
    const starArray = Array(3)
      .fill(0)
      .map((_, i) => i < starsEarned);

    return (
      <div className="flex flex-col items-center justify-center gap-6 py-12 px-4 text-center">
        {showReviewPrompt && (
          <div
            className="fixed inset-0 z-40 bg-black/45 flex items-center justify-center px-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowReviewPrompt(false);
            }}
          >
            <div className="w-full max-w-md rounded-2xl border-4 border-[#BF7B45] bg-white p-5 text-left">
              <p className="text-[#7B3F00] font-black text-lg mb-2">{t('assessmentView.reviewBeforeSubmitTitle')}</p>
              <p className="text-[#5D3A1A] font-semibold text-sm leading-relaxed">
                {t('assessmentView.reviewBeforeSubmitBody')}
              </p>
              <div className="mt-4 flex justify-end gap-3">
                <button
                  onClick={() => setShowReviewPrompt(false)}
                  className="px-4 py-2 rounded-xl border-2 border-[#BF7B45] text-[#7B3F00] font-bold"
                >
                  {t('common.goBack')}
                </button>
                <button
                  onClick={finalizeSubmit}
                  className="px-4 py-2 rounded-xl bg-[#2E8B2E] text-white font-black"
                >
                  {t('assessmentView.submit')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Trophy icon */}
        <div className="w-24 h-24 rounded-full bg-[#F5C47A] border-[5px] border-[#F5C47A] flex items-center justify-center shadow-lg">
          <svg viewBox="0 0 24 24" className="w-12 h-12 text-[#7B3F00]" fill="currentColor" aria-hidden>
            <path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94A5.01 5.01 0 0 0 11 15.9V18H9v2h6v-2h-2v-2.1a5.01 5.01 0 0 0 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zm-2 3c0 1.65-1.35 3-3 3s-3-1.35-3-3V5h6v3zm-8 0c0 1.65-1.35 3-3 3S3 9.65 3 8V7h2v1zm8 0H7V7h10v1z" />
          </svg>
        </div>

        {/* Heading */}
        <div>
          <h2
            className="font-black text-[2rem] leading-tight"
            style={{
              fontFamily: 'var(--font-baloo)',
              color: '#7B3F00',
              WebkitTextStroke: '1.5px #5D3A1A',
              textShadow: '2px 2px 0 #5D3A1A',
            }}
          >
            {t('assessmentPage.title')}
          </h2>
          <p className="text-[#4A2C0A] font-bold text-base mt-1">
            <span className="font-black">{t('lessonView.levelLabel').replace('{{number}}', String(levelNum))}</span>
            {'  '}
            <span className="font-semibold">{levelLabel}</span>
          </p>
        </div>

        {/* Score card */}
        <div className="w-full max-w-sm bg-[#FFF8EE] border-4 border-[#FFF8EE] rounded-[24px] px-8 py-8 shadow-md">
          <p className="text-[#7B3F00] font-black text-lg mb-4">Assessment Complete!</p>
          <p className="text-[#7B3F00] font-black text-3xl mb-2">{score}%</p>
          <p className="text-[#A86040] font-semibold text-sm mb-6">
            {starsEarned >= 3 ? 'Excellent!' : starsEarned >= 2 ? 'Good job!' : starsEarned >= 1 ? 'Keep trying!' : 'Try again!'}
          </p>

          {/* Star row */}
          <div className="flex justify-center gap-3 text-4xl">
            {starArray.map((filled, i) => (
              <span key={i} className={filled ? 'text-yellow-400' : 'text-gray-300'}>
                ★
              </span>
            ))}
          </div>
        </div>

        {/* Back to Dashboard */}
        <button
          onClick={handleFinishClick}
          className="
            bg-[#2E8B2E] hover:bg-[#329932] text-white
            font-black uppercase tracking-widest text-base
            px-12 py-3 rounded-full
            shadow-[0_6px_0_#1a5c1a]
            active:translate-y-1 active:shadow-[0_2px_0_#1a5c1a]
            transition-all
          "
        >
          {t('assessmentView.backToDashboard')}
        </button>
      </div>
    );
  }

  const current = questions[currentIndex];

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Progress */}
      <div className="text-center text-[#4A2C0A] font-bold">
        Question {currentIndex + 1} of {questions.length}
      </div>

      {/* Question display */}
      <div className="flex-1 min-h-0">
        {current.type === 'perform' ? (
          <PracticeView
            letter={current.correctSign}
            letterIndex={currentIndex}
            totalLetters={questions.length}
            levelId={chapterId}
            onNext={handleNext}
            onResult={handleResult}
          />
        ) : (
          <IdentifyView
            questionText={current.questionText}
            videoUrl={current.videoUrl}
            optionA={current.optionA}
            optionB={current.optionB}
            optionC={current.optionC}
            optionD={current.optionD}
            correctAnswer={current.correctAnswer}
            questionIndex={currentIndex}
            totalQuestions={questions.length}
            onNext={handleNext}
          />
        )}
      </div>
    </div>
  );
}
