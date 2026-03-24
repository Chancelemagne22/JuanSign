'use client';

import { useState } from 'react';
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
              CHANGE PASSWORD
            </p>
          </div>
          <div className="absolute -bottom-[5px] left-4 right-4 h-3 bg-[#C47A3A] rounded-b-sm" />
        </div>

        {/* ── Body ─────────────────────────────────────────────── */}
        <div className="pt-10 pb-8 px-responsive-md">
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
            <label className="block text-sm font-bold text-[#7B3F00] mb-2">
              Current Password
            </label>
            <div className="relative">
              <input
                type={showCurrentPw ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={loading || success}
                placeholder="Enter your current password"
                className="w-full px-4 py-3 rounded-full bg-[#D4956A] text-[#7B3F00] placeholder-[#8B6F47]/60 focus:outline-none focus:ring-2 focus:ring-[#7B3F00] disabled:opacity-60 shadow-inner"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPw(!showCurrentPw)}
                disabled={loading || success}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#7B3F00] hover:opacity-70 disabled:opacity-40"
              >
                <EyeIcon open={showCurrentPw} />
              </button>
            </div>
          </div>

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
                disabled={loading || success}
                placeholder="Enter your new password"
                className="w-full px-4 py-3 rounded-full bg-[#D4956A] text-[#7B3F00] placeholder-[#8B6F47]/60 focus:outline-none focus:ring-2 focus:ring-[#7B3F00] disabled:opacity-60 shadow-inner"
              />
              <button
                type="button"
                onClick={() => setShowNewPw(!showNewPw)}
                disabled={loading || success}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#7B3F00] hover:opacity-70 disabled:opacity-40"
              >
                <EyeIcon open={showNewPw} />
              </button>
            </div>
          </div>

          {/* Confirm Password Field */}
          <div className="mb-6">
            <label className="block text-sm font-bold text-[#7B3F00] mb-2">
              Confirm New Password
            </label>
            <div className="relative">
              <input
                type={showConfirmPw ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading || success}
                placeholder="Confirm your new password"
                className="w-full px-4 py-3 rounded-full bg-[#D4956A] text-[#7B3F00] placeholder-[#8B6F47]/60 focus:outline-none focus:ring-2 focus:ring-[#7B3F00] disabled:opacity-60 shadow-inner"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPw(!showConfirmPw)}
                disabled={loading || success}
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

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-3 px-4 rounded-full bg-gray-400 text-white font-bold uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleChangePassword}
              disabled={loading || success}
              className="flex-1 py-3 px-4 rounded-full font-bold uppercase tracking-wider text-white transition-all"
              style={{
                backgroundColor: success ? '#4CAF50' : '#2E8B2E',
                boxShadow: success ? 'none' : '0 6px 0 #1a5c1a',
                transform: loading ? 'translateY(2px)' : 'translateY(0)',
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
