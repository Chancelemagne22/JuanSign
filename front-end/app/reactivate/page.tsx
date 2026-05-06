'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { useState, useEffect, Suspense } from 'react';

// PART 1: The logic that uses the URL (Search Params)
function ReactivateContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email');
  
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [stats, setStats] = useState({ stars: 0, level: 'N/A' });

  useEffect(() => {
    async function fetchLegacyData() {
      const { data } = await supabase
        .from('profiles')
        .select('total_stars, current_level')
        .eq('email', email)
        .single();
      if (data) setStats({ stars: data.total_stars, level: data.current_level });
    }
    if (email) fetchLegacyData();
  }, [email, supabase]);

  const handleRestore = async () => {
    const { error } = await supabase
      .from('profiles')
      .update({ is_archived: false, archived_at: null })
      .eq('email', email);

    if (!error) {
      alert("Welcome back! Your progress is restored.");
      router.push('/dashboard');
    }
  };

  const handleReset = async () => {
    const confirmReset = confirm(`Are you sure? This will permanently delete your progress.`);
    if (!confirmReset) return;

    await fetch(`/api/user/reset?email=${email}`, { method: 'POST' });
    router.push('/dashboard');
  };

  return (
    <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl p-10 text-center border-4 border-white">
      <div className="text-6xl mb-4">👋</div>
      <h1 className="text-3xl font-black text-slate-800 mb-2">Welcome Back!</h1>
      <p className="text-slate-500 mb-8">We found your archived account. What would you like to do?</p>

      <div className="bg-slate-50 rounded-3xl p-6 mb-8 flex justify-around items-center border border-slate-100">
        <div>
          <div className="text-2xl font-black text-yellow-500">⭐ {stats.stars}</div>
          <div className="text-xs font-bold text-slate-400 uppercase">Stars Saved</div>
        </div>
        <div className="h-8 w-[1px] bg-slate-200"></div>
        <div>
          <div className="text-lg font-black text-green-600">{stats.level}</div>
          <div className="text-xs font-bold text-slate-400 uppercase">Last Level</div>
        </div>
      </div>

      <div className="space-y-4">
        <button 
          onClick={handleRestore}
          className="w-full bg-green-500 hover:bg-green-600 text-white py-4 rounded-2xl font-black shadow-lg transition-all active:scale-95"
        >
          PICK UP WHERE I LEFT OFF
        </button>
        
        <button 
          onClick={handleReset}
          className="w-full bg-white hover:bg-slate-50 text-slate-400 py-4 rounded-2xl font-bold border-2 border-slate-100 transition-all"
        >
          START FRESH (RESET DATA)
        </button>
      </div>
    </div>
  );
}

// PART 2: The actual Page that Next.js sees (Wraps everything in Suspense)
export default function ReactivatePage() {
  return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center p-6">
      <Suspense fallback={<div className="text-slate-400 font-bold">Loading recovery options...</div>}>
        <ReactivateContent />
      </Suspense>
    </div>
  );
}