'use client';

import { useState } from 'react';
import Image from 'next/image';
import WoodArc from '@/public/images/svgs/arc.svg';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/hooks/useLanguage';

interface Props {
  onClose: () => void;
  onBackToLogin: () => void;
}

export default function ForgotPasswordModal({ onClose, onBackToLogin }: Props) {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleForgotPassword() {
    setError(null);
    setSuccess(false);

    if (!email.trim()) {
      setError(t('forgotPassword.emailRequired'));
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError(t('forgotPassword.invalidEmail'));
      return;
    }

    setLoading(true);

    try {
      await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/reset-password`,
        }
      );

      setLoading(false);

      // Always show success message - don't reveal if email exists (security best practice)
      // This prevents account enumeration attacks
      setSuccess(true);
      setEmail('');

      // Auto-close after 4 seconds
      setTimeout(onBackToLogin, 4000);
    } catch (err) {
      setLoading(false);
      setError(t('forgotPassword.unexpectedError'));
      console.error('Forgot password error:', err);
    }
  }

  return (
    /* ── Backdrop ──────────────────────────────────────────────── */
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4"
      onClick={onClose}
    >
      {/* ── Card ─────────────────────────────────────────────────── */}
      <div
        className="modal-responsive-sm rounded-[38px]"
        style={{
          backgroundImage: 'url(/images/svgs/banner.svg)',
          backgroundSize: '100% 100%',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          minHeight: '430px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Arc.svg — "RESET PASSWORD" sign ───────────────────────────── */}
        <div className="absolute left-1/2 w-[92%] max-w-[250px]"
          style={{ 
            top: '0',
            transform: 'translate(-50%, -50%)',
            zIndex: 100,
            filter: 'drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3))'
          }}>
          <div className="relative">
            <Image
              src={WoodArc}
              alt=""
              width={250}
              height={70}
              className="w-full h-auto"
              aria-hidden
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <p
                className="text-white font-black uppercase tracking-[0.25em] text-[clamp(0.6rem,2vw,0.9rem)] leading-none"
                style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}
              >
                {t('forgotPassword.title')}
              </p>
            </div>
          </div>
        </div>

        {/* ── Body ─────────────────────────────────────────────── */}
        <div
          className={success
            ? 'relative z-10 h-full min-h-[430px] px-5 flex flex-col items-center justify-center text-center gap-5 max-w-[320px] mx-auto w-full'
            : 'relative z-10 h-full min-h-[430px] pt-20 pb-8 px-10 flex flex-col gap-3 max-w-[290px] mx-auto w-full'}
        >
          
          {/* Success message */}
          {success && (
            <div className="mb-5 p-4 rounded-lg bg-green-100 border border-green-400">
              <p className="text-green-800 text-sm font-semibold text-center mb-2">
                ✓ Check your email
              </p>
              <p className="text-green-700 text-xs text-center">
                If this email exists in our system, you'll receive a password reset link. It will expire in 24 hours.
              </p>
            </div>
          )}

          {/* Error message */}
          {error && !success && (
            <p className="text-red-800 text-xs font-semibold text-center mb-4 px-2">
              {error}
            </p>
          )}

          {!success && (
            <>
              {/* Explanation text */}
              <p className="text-[#7B3F00] text-sm text-center leading-relaxed mb-2">
                {t('forgotPassword.description')}
              </p>

              {/* Email Field */}
              <div className="mb-2">
                <label className="block text-[0.95rem] font-semibold text-[#7B3F00] mb-1">
                  {t('forgotPassword.emailLabel')}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  placeholder={t('forgotPassword.emailPlaceholder')}
                  className="w-full rounded-full bg-[#D4956A] text-[#5D3A1A] placeholder-[#A86040] font-medium px-5 py-2 outline-none border-2 border-[#B87D54] shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] text-sm md:text-base disabled:opacity-60"
                />
              </div>

              {/* Info text */}
              <p className="text-xs text-[#7B3F00] text-center opacity-75 leading-relaxed mt-1">
                {t('forgotPassword.expiresInfo')}
              </p>

              {/* Buttons */}
              <div className="mt-auto pt-6 flex gap-3 justify-center">
                <button
                  onClick={onBackToLogin}
                  disabled={loading}
                  className="py-2 px-4 rounded-full bg-gray-400 text-white font-bold uppercase tracking-wide hover:bg-gray-500 shadow-[0_4px_0_rgba(0,0,0,0.3),0_6px_12px_rgba(0,0,0,0.2)] active:shadow-[0_2px_0_rgba(0,0,0,0.3),0_4px_6px_rgba(0,0,0,0.1)] active:translate-y-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-xs md:text-sm"
                >
                  {t('forgotPassword.back')}
                </button>
                <button
                  onClick={handleForgotPassword}
                  disabled={loading}
                  className="py-2 px-4 rounded-full font-bold uppercase tracking-wide text-white shadow-[0_4px_0_#1a5c1a,0_6px_12px_rgba(0,0,0,0.2)] active:shadow-[0_2px_0_#1a5c1a,0_4px_6px_rgba(0,0,0,0.1)] active:translate-y-1 transition-all disabled:opacity-60 disabled:cursor-not-allowed text-xs md:text-sm"
                  style={{
                    backgroundColor: '#2E8B2E',
                  }}
                  onMouseEnter={(e) => {
                    if (!loading) {
                      (e.target as HTMLButtonElement).style.backgroundColor = '#329932';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!loading) {
                      (e.target as HTMLButtonElement).style.backgroundColor = '#2E8B2E';
                    }
                  }}
                >
                  {loading ? t('forgotPassword.sending') : t('forgotPassword.sendResetLink')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
