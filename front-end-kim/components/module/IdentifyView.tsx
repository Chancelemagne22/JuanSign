'use client';

// COMPONENT: IdentifyView
// Shows a multiple-choice question (optional video + 4 options).
// Used by both Practice (no timer) and Assessment (timer passed from parent).

import { useState } from 'react';

interface Props {
  questionText:   string;
  videoUrl:       string | null;
  optionA:        string;
  optionB:        string;
  optionC:        string;
  optionD:        string;
  correctAnswer:  string;           // 'A' | 'B' | 'C' | 'D'
  questionIndex:  number;
  totalQuestions: number;
  /** Called after the user confirms their answer; passes 1.0 if correct, 0.0 if wrong */
  onNext: (accuracy: number) => void;
}

const OPTION_KEYS = ['A', 'B', 'C', 'D'] as const;

export default function IdentifyView({
  questionText,
  videoUrl,
  optionA, optionB, optionC, optionD,
  correctAnswer,
  questionIndex,
  totalQuestions,
  onNext,
}: Props) {
  const options = { A: optionA, B: optionB, C: optionC, D: optionD };

  const [selected,  setSelected]  = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  function handleConfirm() {
    if (!selected || confirmed) return;
    setConfirmed(true);
  }

  function handleNext() {
    onNext(selected === correctAnswer ? 1.0 : 0.0);
  }

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto pb-4">

      {/* ── Progress ──────────────────────────────────────────────── */}
      <p className="text-center text-[#4A2C0A] font-bold text-sm">
        Question {questionIndex + 1} / {totalQuestions}
      </p>

      {/* ── Video (if provided) ───────────────────────────────────── */}
      {videoUrl && (
        <div className="w-full rounded-[20px] overflow-hidden border-4 border-[#BF7B45] bg-black aspect-video">
          <video src={videoUrl} controls className="w-full h-full object-contain" />
        </div>
      )}

      {/* ── Question text ─────────────────────────────────────────── */}
      <p
        className="text-center font-bold text-[1rem] text-[#4A2C0A] px-2"
        style={{ fontFamily: 'var(--font-fredoka)' }}
      >
        {questionText}
      </p>

      {/* ── Options ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 px-1">
        {OPTION_KEYS.map((key) => {
          const showCorrect = confirmed && key === correctAnswer;
          const showWrong   = confirmed && selected === key && key !== correctAnswer;
          const isSelected  = selected === key && !confirmed;

          let bg   = 'bg-[#F5E6C8] border-[#BF7B45] text-[#5D3A1A]';
          if (showCorrect) bg = 'bg-green-500 border-green-700 text-white';
          else if (showWrong)  bg = 'bg-red-500   border-red-700   text-white';
          else if (isSelected) bg = 'bg-[#E8A87C] border-[#BF7B45] text-[#5D3A1A]';

          return (
            <button
              key={key}
              disabled={confirmed}
              onClick={() => setSelected(key)}
              className={`rounded-2xl border-[3px] px-4 py-3 font-bold text-sm text-left transition-all shadow-sm disabled:cursor-default ${bg}`}
              style={{ fontFamily: 'var(--font-fredoka)' }}
            >
              <span className="font-black mr-1">{key}.</span> {options[key]}
            </button>
          );
        })}
      </div>

      {/* ── Feedback ──────────────────────────────────────────────── */}
      {confirmed && (
        <p
          className={`text-center font-black text-sm ${selected === correctAnswer ? 'text-green-600' : 'text-red-600'}`}
          style={{ fontFamily: 'var(--font-fredoka)' }}
        >
          {selected === correctAnswer
            ? '✓ Correct!'
            : `✗ Wrong — the answer is ${correctAnswer}. ${options[correctAnswer as keyof typeof options]}`}
        </p>
      )}

      {/* ── Action buttons ────────────────────────────────────────── */}
      <div className="flex justify-center gap-3 mt-auto">
        {!confirmed ? (
          <button
            onClick={handleConfirm}
            disabled={!selected}
            className="
              bg-[#2E8B2E] hover:bg-[#329932] text-white font-black
              px-10 py-3 rounded-full shadow-[0_5px_0_#1a5c1a]
              active:translate-y-1 active:shadow-[0_1px_0_#1a5c1a]
              transition-all disabled:opacity-40 disabled:cursor-not-allowed
            "
            style={{ fontFamily: 'var(--font-fredoka)' }}
          >
            Confirm
          </button>
        ) : (
          <button
            onClick={handleNext}
            className="
              bg-[#2E8B2E] hover:bg-[#329932] text-white font-black
              px-10 py-3 rounded-full shadow-[0_5px_0_#1a5c1a]
              active:translate-y-1 active:shadow-[0_1px_0_#1a5c1a]
              transition-all
            "
            style={{ fontFamily: 'var(--font-fredoka)' }}
          >
            {questionIndex < totalQuestions - 1 ? 'Next →' : 'Finish →'}
          </button>
        )}
      </div>

    </div>
  );
}
