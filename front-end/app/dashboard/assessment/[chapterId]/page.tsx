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
import { supabase } from '@/lib/supabase';
import AssessmentView from '@/components/module/AssessmentView';

interface LevelMeta {
  levelNum: number;
  label:    string;
}

export default function AssessmentChapterPage() {
  const router            = useRouter();
  const { chapterId }     = useParams<{ chapterId: string }>();

  const [levelMeta, setLevelMeta] = useState<LevelMeta | null>(null);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/'); return; }

      const { data: level } = await supabase
        .from('levels')
        .select('level_name, level_order')
        .eq('level_id', chapterId)
        .single();

      setLevelMeta({
        levelNum: level?.level_order ?? 1,
        label:    level?.level_name        ?? 'Chapter',
      });
      setLoading(false);
    }
    init();
  }, [chapterId, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p className="text-[#7B3F00] font-bold text-lg animate-pulse">Loading…</p>
      </div>
    );
  }

  if (!levelMeta) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <p className="text-[#7B3F00] font-semibold text-center">Chapter not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white px-6 pt-5 pb-12">

      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => router.replace('/dashboard/assessment')}
          className="w-11 h-11 rounded-full bg-[#E8A87C] border-[3px] border-[#BF7B45] flex items-center justify-center shadow-md hover:scale-105 transition-transform"
          aria-label="Back to assessment list"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>
      </div>

      {/* ── Assessment view ───────────────────────────────────────── */}
      <AssessmentView
        levelNum={levelMeta.levelNum}
        levelLabel={levelMeta.label}
        onFinish={() => router.replace('/dashboard/assessment')}
      />

    </div>
  );
}
