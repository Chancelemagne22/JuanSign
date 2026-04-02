'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import WoodArc from '@/public/images/svgs/arc.svg';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/hooks/useLanguage';
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
  onForgotPasswordClick?: () => void;
  noticeMessage?: string;
}

export default function LoginModal({
  onClose,
  onLogin,
  onSignupClick,
  onForgotPasswordClick,
  noticeMessage,
}: Props) {
  const router = useRouter();
  const { t } = useLanguage();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function handleLogin() {
    setError(null);

    if (!username.trim() || !password) {
      setError(t('login.missingCredentials'));
      return;
    }

    setLoading(true);

    // Resolve username → email via a SECURITY DEFINER RPC so auth.users
    // is never exposed to the client.
    const { data: emailData, error: rpcError } = await supabase
      .rpc('get_email_by_username', { p_username: username.trim() });

    if (rpcError || !emailData) {
      setLoading(false);
      setError(t('login.usernameNotFound'));
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
      .select('level_id', { count: 'exact', head: true });
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
        className="modal-responsive-sm max-w-[420px] rounded-[38px]"
        style={{ backgroundImage: "url('/images/svgs/banner.svg')", 
          backgroundSize: 'contain',        // or 'contain'
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
          
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Arc.svg — "LOGIN" sign ───────────────────────────── */}
        <div className="absolute left-1/2 w-[82%] max-w-[220px]"
                  style={{ 
                    top: '0',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 100,
                    filter: 'drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3))'
                  }}
                >
                  <div className="relative">
                    <Image
                      src={WoodArc}
                      alt=""
                      width={448}
                      height={126}
                      className="w-full h-auto"
                      aria-hidden
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <p
                        className="text-white font-black uppercase tracking-[0.25em] text-[clamp(1rem,4vw,1.4rem)] leading-none"
                        style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}
                      >
                {t('login.title')}
              </p>
            </div>
          </div>
        </div>

        {/* ── Form body ────────────────────────────────────────── */}
        <div className="relative z-10 pt-12 pb-8 px-10 flex flex-col gap-1 max-w-[300px] mx-auto w-full">

          {noticeMessage && (
            <div className="mb-3 p-2.5 rounded-lg bg-green-100 border border-green-400">
              <p className="text-green-800 text-xs font-semibold text-center leading-snug">
                {noticeMessage}
              </p>
            </div>
          )}

          {/* Username */}
          <label className="block text-[#7B3F00] font-semibold text-[0.95rem] mb-1">
            {t('login.usernameLabel')}
          </label>
          <input
            type="text"
            placeholder={t('login.usernamePlaceholder')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            disabled={loading}
            className="w-full rounded-full bg-[#D4956A] placeholder-[#A86040] text-[#5D3A1A] font-medium px-5 py-2 outline-none border-2 border-[#B87D54] shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] text-sm md:text-base disabled:opacity-60"
          />

          {/* Password */}
          <label className="block text-[#7B3F00] font-semibold text-[0.95rem] mb-1">
            {t('login.passwordLabel')}
          </label>
          <div className="relative mb-4">
            <input
              type={showPw ? 'text' : 'password'}
              placeholder={t('login.passwordPlaceholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              disabled={loading}
              className="w-full rounded-full bg-[#D4956A] placeholder-[#A86040] text-[#5D3A1A] font-medium px-5 py-2 outline-none border-2 border-[#B87D54] shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] text-sm md:text-base disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[#7B3F00] hover:text-[#5D3A1A] transition-colors"
              aria-label={t('login.togglePasswordVisibility')}
            >
              <EyeIcon open={showPw} />
            </button>
          </div>

          {/* Error message */}
          {error && (
            <div className="min-h-[32px] flex items-center justify-center mb-2">
              <p className="text-red-800 text-[11px] font-bold text-center px-4 leading-tight">
                {error}
              </p>
            </div>
          )}

          {/* LOGIN button */}
          <div className="flex justify-center mb-3">
            <button
              type="button"
              onClick={handleLogin}
              disabled={loading}
              className={[
                'bg-[#2E8B2E] hover:bg-[#329932] text-white font-black uppercase rounded-full',
                'py-2.5 whitespace-nowrap leading-none',
                'px-7 md:px-12',
                'shadow-[0_6px_0_#1a5c1a,0_8px_16px_rgba(0,0,0,0.3)]',
                'hover:shadow-[0_6px_0_#1a5c1a,0_8px_16px_rgba(0,0,0,0.3)] hover:translate-y-0 hover:scale-100',
                'active:shadow-[0_2px_0_#1a5c1a,0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-1',
                'transition-all disabled:opacity-60 disabled:cursor-not-allowed',
                loading
                  ? 'text-xs md:text-sm tracking-wide'
                  : 'text-sm md:text-xl tracking-widest',
              ].join(' ')}
            >
              {loading ? t('login.loggingIn') : t('login.loginButton')}
            </button>
          </div>

          {/* Forgot Password link */}
          <div className="text-center mb-2">
            <button
              onClick={onForgotPasswordClick}
              className="text-[#7B3F00] font-normal text-sm hover:text-[#5D3A1A] underline transition-colors"
            >
              {t('login.forgotPassword')}
            </button>
          </div>

        </div>
      </div>

      {/* ── Below-card signup link ────────────────────────────────── */}
      <p
        className="mt-4 text-[#F5C47A] font-normal text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {t('login.noAccount')}{' '}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSignupClick();
          }}
          className="text-[#2E8B2E] underline font-bold hover:text-[#1a5c1a] transition-colors"
        >
          {t('login.signupCta')}
        </button>
      </p>

      {/* ── Admin access ─────────────────────────────────────────── */}
      <button
        onClick={() => { onClose(); router.push('/admin/login'); }}
        className="mt-2 text-[#2E8B2E] text-l font-semibold hover:text-white transition-colors opacity-100 hover:opacity-100"
      >
        {t('login.adminAccess')}
      </button>
    </div>
  );
}
