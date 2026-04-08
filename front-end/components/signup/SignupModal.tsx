'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import WoodArc from '@/public/images/svgs/arc.svg';
import { supabase } from '@/lib/supabase';
import { logSupabaseHealthCheck } from '@/lib/supabaseHealthCheck';
import { retryWithBackoff } from '@/lib/retryUtils';
import VerifyEmailPrompt from '@/components/auth/VerifyEmailPrompt';
import { useLanguage } from '@/hooks/useLanguage';
import type { UserData } from '@/types/user';

/* Eye icon — open / closed variants */
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

/* Green checkbox used next to the uploaded filename */
function GreenCheck() {
  return (
    <div className="w-6 h-6 bg-green-500 rounded border-2 border-green-500 flex items-center justify-center flex-shrink-0">
      <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.5} d="M5 13l4 4L19 7" />
      </svg>
    </div>
  );
}

interface Props {
  onClose: () => void;
  onLoginClick: () => void;
  onSuccess?: (user: UserData) => void;
}

export default function SignupModal({ onClose, onLoginClick, onSuccess }: Props) {
  const { t } = useLanguage();
  const [firstName,   setFirstName]   = useState('');
  const [lastName,    setLastName]    = useState('');
  const [username,    setUsername]    = useState('');
  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [confirm,     setConfirm]     = useState('');
  const [showPw,      setShowPw]      = useState(false);
  const [showCf,      setShowCf]      = useState(false);
  const [photo,       setPhoto]       = useState<File | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [showVerifyPrompt, setShowVerifyPrompt] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendSecondsLeft, setResendSecondsLeft] = useState(0);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Run health check on mount to diagnose connectivity issues
  useEffect(() => {
    logSupabaseHealthCheck().catch(console.error);
  }, []);

  useEffect(() => {
    if (resendSecondsLeft <= 0) return;

    const timeoutId = window.setTimeout(() => {
      setResendSecondsLeft((prev) => prev - 1);
    }, 1000);

    return () => window.clearTimeout(timeoutId);
  }, [resendSecondsLeft]);

  async function handleResendVerificationEmail() {
    if (isResending || resendSecondsLeft > 0) return;

    setResendMessage(null);
    setResendError(null);

    if (!email.trim()) {
      setResendError(t('verifyEmail.missingEmail'));
      return;
    }

    setIsResending(true);

    const { error: resendRequestError } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: {
        emailRedirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/confirm?next=/`,
      },
    });

    setIsResending(false);

    if (resendRequestError) {
      const resendMessageLower = (resendRequestError.message ?? '').toLowerCase();
      const isRateLimitedButLikelySent =
        resendMessageLower.includes('rate limit') ||
        resendMessageLower.includes('too many') ||
        resendMessageLower.includes('security purposes') ||
        resendMessageLower.includes('already');

      if (isRateLimitedButLikelySent) {
        // Supabase can reject repeated resend requests while a recent email was already sent.
        setResendMessage(t('verifyEmail.sent'));
        setResendSecondsLeft(30);
        return;
      }

      setResendError(t('verifyEmail.resendFailed'));
      return;
    }

    setResendMessage(t('verifyEmail.sent'));
    setResendSecondsLeft(10);
  }

  async function handleSignup() {
    setError(null);

    if (!firstName.trim() || !lastName.trim() || !username.trim() || !email.trim() || !password) {
      setError(t('signup.requiredFields'));
      return;
    }
    if (password !== confirm) {
      setError(t('signup.passwordsDoNotMatch'));
      return;
    }

    setLoading(true);

    try {
      // 1. Create the auth user — pass all profile fields as metadata
      console.log('[Signup] Starting signup process with email:', email);
      console.log('[Signup] Supabase config - URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
      
      // Use retry with backoff to handle transient network failures
      const { data: authData, error: signUpError } = await retryWithBackoff(
        () => supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/confirm?next=/`,
            data: {
              username:   username.trim(),
              first_name: firstName.trim(),
              last_name:  lastName.trim(),
            },
          },
        }),
        {
          maxAttempts: 3,
          initialDelayMs: 1000,
          maxDelayMs: 5000,
          backoffMultiplier: 2,
        }
      );

      if (signUpError) {
        console.error('[Signup] Error during signup:', signUpError);
        
        // Provide more detailed error messages
        let errorMessage = signUpError.message;
        if (errorMessage.includes('fetch') || errorMessage.includes('Failed to fetch')) {
          errorMessage = 'Network error: Unable to reach authentication service. Please check your internet connection and try again.';
          console.error('[Signup] Network connectivity issue detected');
        }
        
        setLoading(false);
        setError(errorMessage);
        return;
      }

      console.log('[Signup] Signup successful, user ID:', authData.user?.id);

      const userId = authData.user?.id;
      const session = authData.session;   // null when email confirmation is required

      // 2. Upload avatar + update profile via server-side API route (uses service
      //    role key) so it works even when session is null (email confirmation on).
      let avatarUrl: string | null = null;
      let localAvatarWarn: string | null = null;

      if (userId) {
        const fd = new FormData();
        fd.append('userId',    userId);
        fd.append('username',  username.trim());
        fd.append('firstName', firstName.trim());
        fd.append('lastName',  lastName.trim());
        if (photo) fd.append('photo', photo);

        const res = await fetch('/api/post-signup', { method: 'POST', body: fd });
        if (res.ok) {
          const data = await res.json();
          avatarUrl = data.avatarUrl ?? null;
        } else {
          localAvatarWarn = t('signup.profileSaveFailed');
        }
      }

      setLoading(false);

      // Email confirmation is ON — session is null until the user clicks the link.
      // Keep the user on the welcome page and show the verify modal in-place.
      if (!session) {
        setResendError(null);
        setResendMessage(null);
        setResendSecondsLeft(0);
        setShowVerifyPrompt(true);
        return;
      }

      const userData: UserData = {
        username:       username.trim(),
        password:       '',
        photoUrl:       avatarUrl,
        stars:          0,
        level:          1,
        completionRate: 0,
      };

      if (onSuccess) {
        // Hand control to the parent — it will show UserProfileModal.
        // Avatar warning (if any) will be visible as a missing photo in the profile.
        onSuccess(userData);
      } else {
        onClose();
      }
    } catch (err) {
      console.error('[Signup] Unexpected error during signup:', err);
      setLoading(false);
      
      const errorMsg = err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.';
      if (errorMsg.includes('fetch') || errorMsg.includes('Failed to fetch')) {
        setError('Network error: Unable to reach authentication service. Please check your internet connection and try again.');
      } else {
        setError(errorMsg);
      }
    }
  }

  if (showVerifyPrompt) {
    return (
      <div
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4"
        onClick={onClose}
      >
        <div onClick={(e) => e.stopPropagation()}>
          <VerifyEmailPrompt
            email={email.trim()}
            onResend={handleResendVerificationEmail}
            onContinue={onClose}
            isResendDisabled={isResending || resendSecondsLeft > 0}
            resendSecondsLeft={resendSecondsLeft}
            feedbackMessage={resendMessage}
            errorMessage={resendError}
          />
        </div>
      </div>
    );
  }

  return (
    /* ── Backdrop ──────────────────────────────────────────────── */
    <div
      className="fixed inset-0 bg-black/60 z-50 flex flex-col items-center justify-center px-4"
      onClick={onClose}
    >
      {/* ── Card ─────────────────────────────────────────────────── */}
      <div
        className="modal-responsive relative"
        style={{
          backgroundImage: "url('/images/svgs/banner.svg')",
          backgroundSize: 'contain',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Arc.svg — "NEW USER" sign ────────────────────────── */}
        <div 
          className="absolute left-1/2 w-[85%] max-w-[300px]"
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
                {t('signup.title')}
              </p>
            </div>
          </div>
        </div>

        {/* ── Form body ────────────────────────────────────────── */}
        <div className="relative z-10 pt-15 pb-7 px-20 flex flex-col gap-3 max-w-[460px] mx-auto w-full">

          {/* First Name + Last Name — Grid layout for visual grouping */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[#7B3F00] font-bold text-xs mb-0.5">
                {t('signup.firstName')}
              </label>
              <input
                type="text"
                placeholder={t('signup.firstNamePlaceholder')}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={loading}
                className="w-full rounded-full bg-[#D4956A] placeholder-[#A86040] text-[#5D3A1A] font-medium px-3 py-1.5 shadow-[inset_0_2px_6px_rgba(93,58,26,0.35)] outline-none focus:ring-2 focus:ring-[#7B3F00]/40 text-xs disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-[#7B3F00] font-bold text-xs mb-0.5">
                {t('signup.lastName')}
              </label>
              <input
                type="text"
                placeholder={t('signup.lastNamePlaceholder')}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={loading}
                className="w-full rounded-full bg-[#D4956A] placeholder-[#A86040] text-[#5D3A1A] font-medium px-3 py-1.5 shadow-[inset_0_2px_6px_rgba(93,58,26,0.35)] outline-none focus:ring-2 focus:ring-[#7B3F00]/40 text-xs disabled:opacity-60"
              />
            </div>
          </div>

          {/* Username */}
          <div>
            <label className="block text-[#7B3F00] font-bold text-xs mb-0.5">
              {t('signup.username')}
            </label>
            <input
              type="text"
              placeholder={t('signup.usernamePlaceholder')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              className="w-full rounded-full bg-[#D4956A] placeholder-[#A86040] text-[#5D3A1A] font-medium px-3 py-1.5 shadow-[inset_0_2px_6px_rgba(93,58,26,0.35)] outline-none focus:ring-2 focus:ring-[#7B3F00]/40 text-xs disabled:opacity-60"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-[#7B3F00] font-bold text-xs mb-0.5">
              {t('signup.email')}
            </label>
            <input
              type="email"
              placeholder={t('signup.emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              className="w-full rounded-full bg-[#D4956A] placeholder-[#A86040] text-[#5D3A1A] font-medium px-3 py-1.5 shadow-[inset_0_2px_6px_rgba(93,58,26,0.35)] outline-none focus:ring-2 focus:ring-[#7B3F00]/40 text-xs disabled:opacity-60"
            />
          </div>

          {/* Password */}
          <div className="relative">
            <label className="block text-[#7B3F00] font-bold text-xs mb-0.5">
              {t('signup.password')}
            </label>
            <input
              type={showPw ? 'text' : 'password'}
              placeholder={t('signup.passwordPlaceholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              className="w-full rounded-full bg-[#D4956A] placeholder-[#A86040] text-[#5D3A1A] font-medium px-3 py-1.5 pr-10 shadow-[inset_0_2px_6px_rgba(93,58,26,0.35)] outline-none focus:ring-2 focus:ring-[#7B3F00]/40 text-xs disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-[1.4rem] text-[#7B3F00] hover:text-[#5D3A1A] transition-colors"
              aria-label={t('login.togglePasswordVisibility')}
            >
              <EyeIcon open={showPw} />
            </button>
          </div>

          {/* Confirm Password */}
          <div className="relative">
            <label className="block text-[#7B3F00] font-bold text-xs mb-0.5">
              {t('signup.confirmPassword')}
            </label>
            <input
              type={showCf ? 'text' : 'password'}
              placeholder={t('signup.confirmPasswordPlaceholder')}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={loading}
              className="w-full rounded-full bg-[#D4956A] placeholder-[#A86040] text-[#5D3A1A] font-medium px-3 py-1.5 pr-10 shadow-[inset_0_2px_6px_rgba(93,58,26,0.35)] outline-none focus:ring-2 focus:ring-[#7B3F00]/40 text-xs disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setShowCf(!showCf)}
              className="absolute right-3 top-[1.4rem] text-[#7B3F00] hover:text-[#5D3A1A] transition-colors"
              aria-label={t('login.togglePasswordVisibility')}
            >
              <EyeIcon open={showCf} />
            </button>
          </div>

          {/* Error message */}
          {error && (
            <p className="text-red-800 text-[0.65rem] font-semibold text-center px-2">
              {error}
            </p>
          )}

          {/* Upload Profile Photo */}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            />
            <div className="flex flex-col sm:flex-row items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={loading}
                className="flex-shrink-0 bg-white text-[#5D3A1A] font-semibold text-[0.65rem] rounded-full px-3 py-1.5 shadow border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-60"
              >
                  {t('signup.uploadProfilePhoto')}
              </button>
              {photo && (
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[#5D3A1A] font-medium text-[0.65rem] truncate">{photo.name}</span>
                  <GreenCheck />
                </div>
              )}
            </div>
          </div>

          {/* SIGNUP button */}
          <div className="flex justify-center pt-0.5">
            <button
              type="button"
              onClick={handleSignup}
              disabled={loading}
              className="
                bg-[#2E8B2E] hover:bg-[#329932] text-white font-black uppercase
                tracking-widest text-sm px-8 py-2 rounded-full
                shadow-[0_3px_0_#1a5c1a]
                active:shadow-[0_1px_0_#1a5c1a] active:translate-y-1
                transition-all disabled:opacity-60 disabled:cursor-not-allowed
              "
            >
              {loading ? t('signup.signingUp') : t('signup.signupButton')}
            </button>
          </div>

        </div>
      </div>

      {/* ── Below-card login link ─────────────────────────────────── */}
      <p
        className="mt-4 text-[#F5C47A] font-bold text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {t('common.loginPrompt')}{' '}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onLoginClick();
          }}
          className="text-green-400 underline font-bold hover:text-green-300 transition-colors"
        >
          {t('common.login')}
        </button>
      </p>
    </div>
  );
}
