'use client';

// PAGE: Password Reset
// ROUTE: /?token=...&type=recovery
// Handles password reset tokens sent via email. User clicks the link
// from the reset email, lands on this page, and enters a new password.

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

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

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [tokenValid, setTokenValid] = useState(false);
  const [tokenChecking, setTokenChecking] = useState(true);

  useEffect(() => {
  async function verifyToken() {
    // 1. Get the parameters from the URL
    const code = searchParams.get('code');   // Modern PKCE flow
    const token = searchParams.get('token'); // Legacy Implicit flow
    const type = searchParams.get('type');

    console.log("[DEBUG] Params detected:", { code: !!code, token: !!token, type });

    // 2. Check if a session already exists 
    // (Supabase often exchanges the code for a session automatically)
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session) {
      console.log("[DEBUG] Active session found, allowing password update.");
      setTokenValid(true);
      setTokenChecking(false);
      return;
    }

    // 3. If no session, manually exchange the code/token
    try {
      if (code) {
        // This is what is likely missing! You must exchange the code for a session.
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        setTokenValid(true);
      } else if (token && type === 'recovery') {
        setTokenValid(true);
      } else {
        // If we get here, neither code nor token is present
        setError('Invalid reset link. Please try requesting a new email.');
      }
    } catch (err: any) {
      console.error("[DEBUG] Verification error:", err.message);
      setError('Your reset link has expired or been used already.');
    } finally {
      setTokenChecking(false);
    }
  }

  verifyToken();
}, [searchParams]);

  async function handleResetPassword() {
    setError(null);
    setSuccess(false);

    // Validation
    if (!newPassword.trim()) {
      setError('Please enter a new password.');
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      // Update the password using the reset token
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      setLoading(false);

      if (updateError) {
        setError(updateError.message || 'Failed to reset password. Please try again.');
        return;
      }

      // Success
      setSuccess(true);
      setNewPassword('');
      setConfirmPassword('');

      // Redirect to login after 3 seconds
      setTimeout(() => {
        router.push('/');
      }, 3000);
    } catch (err) {
      setLoading(false);
      setError('An unexpected error occurred. Please try again.');
      console.error('Password reset error:', err);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#2E7D1C] to-[#1a4d10] flex items-center justify-center px-4 py-8">
      <div className="w-full modal-responsive">
        
        {/* Header */}
        <div className="text-center mb-8">
          <h1
            className="heading-lg"
            style={{
              fontFamily: 'var(--font-spicy-rice)',
              color: '#2E7D1C',
              WebkitTextStroke: '1px #1a4d10',
              textShadow: '1px 1px 0 #1a4d10',
            }}
          >
            Reset Password
          </h1>
          <p className="text-[#F5C47A] font-semibold text-sm md:text-base">
            Enter your new password below
          </p>
        </div>

        {/* Card */}
        <div className="rounded-3xl border-[5px] border-[#C47A3A] bg-[#F5C47A] shadow-2xl px-responsive-md py-responsive-md">
          
          {tokenChecking && (
            <div className="text-center py-8">
              <p className="text-[#7B3F00] font-semibold">Verifying your reset link...</p>
            </div>
          )}

          {!tokenChecking && !tokenValid && (
            <div className="text-center py-8">
              <p className="text-red-800 font-semibold mb-4">{error}</p>
              <Link
                href="/reset-password"
                className="inline-block px-6 py-2 bg-[#2E8B2E] text-white font-bold rounded-full hover:bg-[#329932] transition-colors text-sm md:text-base"
              >
                Back to Home
              </Link>
            </div>
          )}

          {!tokenChecking && tokenValid && (
            <>
              {/* Success message */}
              {success && (
                <div className="mb-6 p-4 rounded-lg bg-green-100 border border-green-400">
                  <p className="text-green-800 text-sm font-semibold text-center mb-2">
                    ✓ Password reset successfully!
                  </p>
                  <p className="text-green-700 text-xs text-center">
                    Redirecting to login page...
                  </p>
                </div>
              )}

              {/* Error message */}
              {error && !success && (
                <p className="text-red-800 text-sm font-semibold text-center mb-4 px-2">
                  {error}
                </p>
              )}

              {!success && (
                <>
                  {/* New Password Field */}
                  <div className="mb-4">
                    <label className="block text-sm font-bold text-[#7B3F00] mb-2">
                      New Password
                    </label>
                    <div className="relative">
                      <input
                        type={showNewPw ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        disabled={loading}
                        placeholder="Enter your new password"
                        className="w-full px-4 py-3 rounded-full bg-[#D4956A] text-[#7B3F00] placeholder-[#8B6F47]/60 focus:outline-none focus:ring-2 focus:ring-[#7B3F00] disabled:opacity-60 shadow-inner text-sm md:text-base"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPw(!showNewPw)}
                        disabled={loading}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-[#7B3F00] hover:opacity-70 disabled:opacity-40"
                      >
                        <EyeIcon open={showNewPw} />
                      </button>
                    </div>
                  </div>

                  {/* Confirm Password Field */}
                  <div className="mb-6">
                    <label className="block text-sm font-bold text-[#7B3F00] mb-2">
                      Confirm Password
                    </label>
                    <div className="relative">
                      <input
                        type={showConfirmPw ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        disabled={loading}
                        placeholder="Confirm your password"
                        className="w-full px-4 py-3 rounded-full bg-[#D4956A] text-[#7B3F00] placeholder-[#8B6F47]/60 focus:outline-none focus:ring-2 focus:ring-[#7B3F00] disabled:opacity-60 shadow-inner text-sm md:text-base"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPw(!showConfirmPw)}
                        disabled={loading}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-[#7B3F00] hover:opacity-70 disabled:opacity-40"
                      >
                        <EyeIcon open={showConfirmPw} />
                      </button>
                    </div>
                  </div>

                  {/* Password requirements */}
                  <p className="text-xs text-[#7B3F00] mb-6 text-center opacity-75">
                    Password must be at least 6 characters long
                  </p>

                  {/* Submit Button */}
                  <button
                    onClick={handleResetPassword}
                    disabled={loading}
                    className="w-full py-3 px-4 rounded-full font-bold uppercase tracking-wider text-white transition-all mb-3 text-sm md:text-base"
                    style={{
                      backgroundColor: '#2E8B2E',
                      boxShadow: '0 6px 0 #1a5c1a',
                      transform: loading ? 'translateY(2px)' : 'translateY(0)',
                    }}
                  >
                    {loading ? 'RESETTING...' : 'RESET PASSWORD'}
                  </button>

                  {/* Back to Login */}
                  <Link
                    href="/"
                    className="block text-center text-[#7B3F00] font-semibold text-sm hover:text-[#5D3A1A] underline transition-colors"
                  >
                    Back to Login
                  </Link>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return <ResetPasswordContent />;
}
