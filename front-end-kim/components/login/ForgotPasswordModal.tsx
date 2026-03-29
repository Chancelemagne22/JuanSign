'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Props {
  onClose: () => void;
  onBackToLogin: () => void;
}

export default function ForgotPasswordModal({ onClose, onBackToLogin }: Props) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleForgotPassword() {
    setError(null);
    setSuccess(false);

    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/reset-password`,
        }
      );

      setLoading(false);

      if (resetError) {
        setError(resetError.message || 'Failed to send reset email. Please try again.');
        return;
      }

      // Success
      setSuccess(true);
      setEmail('');

      // Auto-close after 4 seconds
      setTimeout(onBackToLogin, 4000);
    } catch (err) {
      setLoading(false);
      setError('An unexpected error occurred. Please try again.');
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
        className="modal-responsive rounded-3xl border-[5px] border-[#C47A3A] bg-[#F5C47A] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Banner tab ───────────────────────────────────────── */}
        <div className="absolute -top-[46px] left-1/2 -translate-x-1/2 w-[70%]">
          <div className="relative bg-[#C47A3A] rounded-2xl pt-3 pb-4 px-6 shadow-[0_4px_12px_rgba(0,0,0,0.4)]">
            <div className="absolute top-1.5 left-3 right-3 h-[2px] bg-white/20 rounded-full" />
            <p
              className="text-white text-center font-black uppercase tracking-[0.18em] text-[clamp(0.95rem,3vw,1.35rem)] leading-none"
              style={{ textShadow: '0 2px 4px rgba(0,0,0,0.4)' }}
            >
              RESET PASSWORD
            </p>
          </div>
          <div className="absolute -bottom-[5px] left-4 right-4 h-3 bg-[#C47A3A] rounded-b-sm" />
        </div>

        {/* ── Body ─────────────────────────────────────────────── */}
        <div className="pt-10 pb-8 px-responsive-md">
          
          {/* Success message */}
          {success && (
            <div className="mb-5 p-4 rounded-lg bg-green-100 border border-green-400">
              <p className="text-green-800 text-sm font-semibold text-center mb-2">
                ✓ Reset link sent!
              </p>
              <p className="text-green-700 text-xs text-center">
                Check your email for a password reset link. It will expire in 24 hours.
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
              <p className="text-[#7B3F00] text-sm text-center mb-6">
                Enter your email address and we'll send you a link to reset your password.
              </p>

              {/* Email Field */}
              <div className="mb-6">
                <label className="block text-sm font-bold text-[#7B3F00] mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  placeholder="Enter your email"
                  className="w-full px-4 py-3 rounded-full bg-[#D4956A] text-[#7B3F00] placeholder-[#8B6F47]/60 focus:outline-none focus:ring-2 focus:ring-[#7B3F00] disabled:opacity-60 shadow-inner text-sm md:text-base"
                />
              </div>

              {/* Info text */}
              <p className="text-xs text-[#7B3F00] mb-6 text-center opacity-75">
                The reset link will expire in 24 hours.
              </p>

              {/* Buttons */}
              <div className="flex gap-3 flex-col sm:flex-row">
                <button
                  onClick={onBackToLogin}
                  disabled={loading}
                  className="flex-1 py-3 px-4 rounded-full bg-gray-400 text-white font-bold uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition-all text-sm md:text-base"
                >
                  Back
                </button>
                <button
                  onClick={handleForgotPassword}
                  disabled={loading}
                  className="flex-1 py-3 px-4 rounded-full font-bold uppercase tracking-wider text-white transition-all text-sm md:text-base"
                  style={{
                    backgroundColor: '#2E8B2E',
                    boxShadow: '0 6px 0 #1a5c1a',
                    transform: loading ? 'translateY(2px)' : 'translateY(0)',
                  }}
                >
                  {loading ? 'SENDING...' : 'SEND RESET LINK'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
