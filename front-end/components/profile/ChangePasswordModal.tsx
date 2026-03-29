'use client';

import { useState } from 'react';
import Image from 'next/image';
import WoodArc from '@/public/images/svgs/arc.svg';
import { supabase } from '@/lib/supabase';

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
  onSuccess?: () => void;
}

export default function ChangePasswordModal({ onClose, onSuccess }: Props) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleChangePassword() {
    setError(null);
    setSuccess(false);

    // Validation
    if (!currentPassword.trim()) {
      setError('Please enter your current password.');
      return;
    }

    if (!newPassword.trim()) {
      setError('Please enter a new password.');
      return;
    }

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    if (currentPassword === newPassword) {
      setError('New password must be different from your current password.');
      return;
    }

    setLoading(true);

    try {
      // First, verify the current password by attempting to sign in
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user?.email) {
        setError('Unable to verify your account. Please log in again.');
        setLoading(false);
        return;
      }

      // Try to sign in with current password to verify it's correct
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });

      if (verifyError) {
        setError('Current password is incorrect.');
        setLoading(false);
        return;
      }

      // Update the password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      setLoading(false);

      if (updateError) {
        setError(updateError.message || 'Failed to update password. Please try again.');
        return;
      }

      // Success
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      // Call success callback if provided
      if (onSuccess) {
        setTimeout(onSuccess, 2000);
      } else {
        // Auto-close after 3 seconds
        setTimeout(onClose, 3000);
      }
    } catch (err) {
      setLoading(false);
      setError('An unexpected error occurred. Please try again.');
      console.error('Password change error:', err);
    }
  }

  return (
    /* ── Backdrop ──────────────────────────────────────────────── */
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4"
      onClick={onClose}
    >
      {/* ── Card ───────────────────────── ────────────────────────── */}
      <div
        className="modal-responsive-sm rounded-[38px]"
        style={{
          backgroundImage: 'url(/images/svgs/banner.svg)',
          backgroundSize: 'contain',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Arc.svg — "CHANGE PASSWORD" sign ───────────────────────────── */}
        <div className="absolute left-1/2 w-[85%] max-w-[300px]"
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
                className="text-white font-black uppercase tracking-[0.25em] text-[clamp(0.75rem,3vw,1.1rem)] leading-none"
                style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}
              >
                CHANGE PASSWORD
              </p>
            </div>
          </div>
        </div>

        {/* ── Body ─────────────────────────────────────────────── */}
        <div className="relative z-10 pt-12 pb-8 px-10 flex flex-col gap-1 max-w-[320px] mx-auto w-full">
          {/* Success message */}
          {success && (
            <div className="mb-5 p-3 rounded-lg bg-green-100 border border-green-400">
              <p className="text-green-800 text-sm font-semibold text-center">
                ✓ Password changed successfully!
              </p>
            </div>
          )}

          {/* Error message */}
          {error && !success && (
            <p className="text-red-800 text-xs font-semibold text-center mb-4 px-2">
              {error}
            </p>
          )}

          {/* Current Password Field */}
          <div className="mb-4">
            <label className="block text-[0.95rem] font-semibold text-[#7B3F00] mb-1">
              Current Password
            </label>
            <div className="relative">
              <input
                type={showCurrentPw ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={loading || success}
                placeholder="Enter your current password"
                className="w-full rounded-full bg-[#D4956A] text-[#5D3A1A] placeholder-[#A86040] font-medium px-5 py-2 outline-none border-2 border-[#B87D54] shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] text-sm md:text-base disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPw(!showCurrentPw)}
                disabled={loading || success}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#7B3F00] hover:text-[#5D3A1A] transition-colors disabled:opacity-40"
              >
                <EyeIcon open={showCurrentPw} />
              </button>
            </div>
          </div>

          {/* New Password Field */}
          <div className="mb-4">
            <label className="block text-[0.95rem] font-semibold text-[#7B3F00] mb-1">
              New Password
            </label>
            <div className="relative">
              <input
                type={showNewPw ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={loading || success}
                placeholder="Enter your new password"
                className="w-full rounded-full bg-[#D4956A] text-[#5D3A1A] placeholder-[#A86040] font-medium px-5 py-2 outline-none border-2 border-[#B87D54] shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] text-sm md:text-base disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShowNewPw(!showNewPw)}
                disabled={loading || success}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#7B3F00] hover:text-[#5D3A1A] transition-colors disabled:opacity-40"
              >
                <EyeIcon open={showNewPw} />
              </button>
            </div>
          </div>

          {/* Confirm Password Field */}
          <div className="mb-6">
            <label className="block text-[0.95rem] font-semibold text-[#7B3F00] mb-1">
              Confirm New Password
            </label>
            <div className="relative">
              <input
                type={showConfirmPw ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading || success}
                placeholder="Confirm your new password"
                className="w-full rounded-full bg-[#D4956A] text-[#5D3A1A] placeholder-[#A86040] font-medium px-5 py-2 outline-none border-2 border-[#B87D54] shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] text-sm md:text-base disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPw(!showConfirmPw)}
                disabled={loading || success}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#7B3F00] hover:text-[#5D3A1A] transition-colors disabled:opacity-40"
              >
                <EyeIcon open={showConfirmPw} />
              </button>
            </div>
          </div>

          {/* Password requirements */}
          <p className="text-xs text-[#7B3F00] mb-6 text-center opacity-75">
            Password must be at least 6 characters long
          </p>

          {/* Buttons */}
          <div className="flex gap-3 justify-center">
            <button
              onClick={onClose}
              disabled={loading}
              className="py-2 px-4 rounded-full bg-gray-400 text-white font-bold uppercase tracking-wide hover:bg-gray-500 shadow-[0_4px_0_rgba(0,0,0,0.3),0_6px_12px_rgba(0,0,0,0.2)] active:shadow-[0_2px_0_rgba(0,0,0,0.3),0_4px_6px_rgba(0,0,0,0.1)] active:translate-y-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-xs md:text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleChangePassword}
              disabled={loading || success}
              className="py-2 px-4 rounded-full font-bold uppercase tracking-wide text-white shadow-[0_4px_0_#1a5c1a,0_6px_12px_rgba(0,0,0,0.2)] active:shadow-[0_2px_0_#1a5c1a,0_4px_6px_rgba(0,0,0,0.1)] active:translate-y-1 transition-all disabled:opacity-60 disabled:cursor-not-allowed text-xs md:text-sm"
              style={{
                backgroundColor: success ? '#4CAF50' : '#2E8B2E',
              }}
              onMouseEnter={(e) => {
                if (!loading && !success) {
                  (e.target as HTMLButtonElement).style.backgroundColor = '#329932';
                }
              }}
              onMouseLeave={(e) => {
                if (!loading && !success) {
                  (e.target as HTMLButtonElement).style.backgroundColor = '#2E8B2E';
                }
              }}
            >
              {loading ? 'UPDATING...' : success ? '✓ SUCCESS' : 'CHANGE PASSWORD'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
