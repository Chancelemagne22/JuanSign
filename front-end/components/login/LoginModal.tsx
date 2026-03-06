'use client';

import { useState } from 'react';
import Image from 'next/image';
import WoodArc from '@/public/images/svgs/arc.svg';
import { supabase } from '@/lib/supabase';
import type { UserData } from '@/types/user';

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 7.61 17 4.5 12 4.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
    </svg>
  ) : (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75C21.27 7.61 17 4.5 12 4.5c-1.27 0-2.49.2-3.64.57l2.17 2.17C11.04 7.13 11.51 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zm5.53 5.53 1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" />
    </svg>
  );
}

interface Props {
  onClose: () => void;
  onLogin: (user: UserData) => void;
  onSignupClick: () => void;
}

export default function LoginModal({ onClose, onLogin, onSignupClick }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function handleLogin() {
    setError(null);

    if (!username.trim() || !password) {
      setError('Please enter your username and password.');
      return;
    }

    setLoading(true);

    // Resolve username → email via a SECURITY DEFINER RPC so auth.users
    // is never exposed to the client.
    const { data: emailData, error: rpcError } = await supabase
      .rpc('get_email_by_username', { p_username: username.trim() });

    if (rpcError || !emailData) {
      setLoading(false);
      setError('Username not found. Please check and try again.');
      return;
    }

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email:    emailData as string,
      password,
    });
    setLoading(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    const authUser = data.user;
    const userId   = authUser.id;

    // Fetch real profile data — fall back to metadata if the query fails
    const [profileResult, starsResult, progressResult] = await Promise.all([
      supabase.from('profiles').select('username, avatar_url').eq('auth_user_id', userId).single(),
      supabase.from('assessment_results').select('stars_earned').eq('auth_user_id', userId),
      supabase.from('user_progress').select('is_unlocked, lessons_completed').eq('auth_user_id', userId),
    ]);

    const profile     = profileResult.data;
    const totalStars  = starsResult.data?.reduce((s, r) => s + (r.stars_earned ?? 0), 0) ?? 0;
    const unlocked    = progressResult.data?.filter((p) => p.is_unlocked).length ?? 0;
    const currentLevel = Math.max(unlocked, 1);

    // Completion rate = unlocked levels / total levels * 100
    const { count: totalLevels } = await supabase
      .from('levels')
      .select('id', { count: 'exact', head: true });
    const completionRate = totalLevels
      ? Math.round((unlocked / totalLevels) * 100)
      : 0;

    onLogin({
      username:       profile?.username ?? authUser.user_metadata?.username ?? authUser.email ?? '',
      password:       '',
      photoUrl:       profile?.avatar_url ?? authUser.user_metadata?.avatar_url ?? null,
      stars:          totalStars,
      level:          currentLevel,
      completionRate,
    });
  }

  return (
    /* ── Backdrop ──────────────────────────────────────────────── */
    <div
      className="fixed inset-0 bg-black/60 z-50 flex flex-col items-center justify-center px-4"
      onClick={onClose}
    >
      {/* ── Card ─────────────────────────────────────────────────── */}
      <div
        className="relative w-full max-w-[375px] min-h-[482px] rounded-[38px]"
        style={{ backgroundImage: "url('/images/svgs/banner.svg')", backgroundSize: '100% 100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Arc.svg — "LOGIN" sign ───────────────────────────── */}
        <div className="absolute -top-[45px] left-1/2 -translate-x-1/2 w-[80%] z-20">
          <div className="relative">
            <Image
              src={WoodArc}
              alt=""
              width={448}
              height={126}
              className="w-full h-auto"
              aria-hidden
            />
            {/* Text centred on the wooden plank portion of the arc */}
            <div className="absolute inset-0 flex items-center justify-center pb-6">
              <p
                className="text-white font-black uppercase tracking-[0.18em] text-[1.35rem] leading-none"
                style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}
              >
                LOGIN
              </p>
            </div>
          </div>
        </div>

        {/* ── Form body ────────────────────────────────────────── */}
        <div className="relative z-10 pt-14 pb-5 px-8">

          {/* Username */}
          <label className="block text-[#7B3F00] font-bold text-[0.95rem] mb-1.5">
            Username
          </label>
          <input
            type="text"
            placeholder="Enter your Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            disabled={loading}
            className="w-full rounded-full bg-[#D4956A] placeholder-[#A86040] text-[#5D3A1A] font-medium px-5 py-3 mb-4 outline-none focus:ring-2 focus:ring-[#7B3F00]/40 text-sm disabled:opacity-60"
          />

          {/* Password */}
          <label className="block text-[#7B3F00] font-bold text-[0.95rem] mb-1.5">
            Password
          </label>
          <div className="relative mb-4">
            <input
              type={showPw ? 'text' : 'password'}
              placeholder="Enter your Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              disabled={loading}
              className="w-full rounded-full bg-[#D4956A] placeholder-[#A86040] text-[#5D3A1A] font-medium px-5 py-3 pr-12 outline-none focus:ring-2 focus:ring-[#7B3F00]/40 text-sm disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[#7B3F00] hover:text-[#5D3A1A] transition-colors"
              aria-label="Toggle password visibility"
            >
              <EyeIcon open={showPw} />
            </button>
          </div>

          {/* Error message */}
          {error && (
            <p className="text-red-800 text-xs font-semibold text-center mb-3 px-2">
              {error}
            </p>
          )}

          {/* LOGIN button */}
          <div className="flex justify-center mb-5">
            <button
              type="button"
              onClick={handleLogin}
              disabled={loading}
              className="
                bg-[#2E8B2E] hover:bg-[#329932] text-white font-black uppercase
                tracking-widest text-xl px-16 py-3 rounded-full
                shadow-[0_6px_0_#1a5c1a]
                active:shadow-[0_2px_0_#1a5c1a] active:translate-y-1
                transition-all disabled:opacity-60 disabled:cursor-not-allowed
              "
            >
              {loading ? 'LOGGING IN...' : 'LOGIN'}
            </button>
          </div>

        </div>
      </div>

      {/* ── Below-card signup link ────────────────────────────────── */}
      <p className="mt-4 text-[#F5C47A] font-bold text-sm">
        Don&apos;t have an Account?{' '}
        <button
          onClick={onSignupClick}
          className="text-green-400 underline font-bold hover:text-green-300 transition-colors"
        >
          Signup.
        </button>
      </p>
    </div>
  );
}
