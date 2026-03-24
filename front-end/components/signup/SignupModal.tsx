'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';
import WoodArc from '@/public/images/svgs/arc.svg';
import { supabase } from '@/lib/supabase';
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
    <div className="w-6 h-6 bg-green-500 rounded border-2 border-green-600 flex items-center justify-center flex-shrink-0">
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
  // Tracks post-signup state separately so the user sees what happened
  const [signupDone,  setSignupDone]  = useState(false);
  const [avatarWarn,  setAvatarWarn]  = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSignup() {
    setError(null);

    if (!firstName.trim() || !lastName.trim() || !username.trim() || !email.trim() || !password) {
      setError('Please fill in all required fields.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    // 1. Create the auth user — pass all profile fields as metadata so the
    //    trigger (if updated) can pick them up immediately.
    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username:   username.trim(),
          first_name: firstName.trim(),
          last_name:  lastName.trim(),
        },
      },
    });

    if (signUpError) {
      setLoading(false);
      setError(signUpError.message);
      return;
    }

    const userId  = authData.user?.id;
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
        localAvatarWarn = 'Profile save failed. You can update it later from settings.';
      }
    }

    setLoading(false);

    // Email confirmation is ON — session is null until the user clicks the link.
    // Do NOT call onSuccess (which would open UserProfileModal and route to /dashboard).
    if (!session) {
      setSignupDone(true);
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
    } else if (localAvatarWarn) {
      setAvatarWarn(localAvatarWarn);
      setSignupDone(true);
    } else {
      onClose();
    }
  }

  return (
    /* ── Backdrop ──────────────────────────────────────────────── */
    <div
      className="fixed inset-0 bg-black/60 z-50 flex flex-col items-center justify-center px-4"
      onClick={onClose}
    >
      {/* ── Card ─────────────────────────────────────────────────── */}
      <div
        className="modal-responsive rounded-[38px]"
        style={{ backgroundImage: "url('/images/svgs/banner.svg')", 
          backgroundSize: 'contain',        // or 'contain'
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'}}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Arc.svg — "NEW USER" sign ────────────────────────── */}
        <div className="absolute top-[20px] left-1/2 -translate-x-1/2 w-[25%] z-20">
          <div className="relative">
            <Image
              src={WoodArc}
              alt=""
              width={448}
              height={126}
              className="w-full h-auto"
              aria-hidden
            />
            <div className="absolute inset-0 flex items-center justify-center pb-6">
              <p
                className="text-white font-black uppercase tracking-[0.18em] text-[clamp(1.5rem,4vw,2.35rem)] leading-none"
                style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}
              >
                NEW USER
              </p>
            </div>
          </div>
        </div>

        {/* ── Post-signup result screen ────────────────────────── */}
        {signupDone && (
          <div className="relative z-10 pt-24 pb-8 mt-10 flex flex-col items-center gap-4 text-center px-8">
            <div className="w-14 h-14 bg-green-500 rounded-full flex items-center justify-center shadow-lg">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-[#5D3A1A] font-black text-lg">Account Created!</p>
            <p className="text-[#7B3F00] font-semibold text-sm leading-snug">
              We sent a confirmation link to <span className="font-black">{email}</span>.
              Please check your inbox and click the link before logging in.
            </p>
            {avatarWarn && (
              <div className="bg-amber-100 border border-amber-400 rounded-2xl px-4 py-3 w-full">
                <p className="text-amber-800 font-semibold text-xs leading-snug">{avatarWarn}</p>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-2 bg-[#2E8B2E] hover:bg-[#329932] text-white font-black uppercase tracking-widest text-base px-12 py-3 rounded-full shadow-[0_6px_0_#1a5c1a] active:shadow-[0_2px_0_#1a5c1a] active:translate-y-1 transition-all"
            >
              Got it
            </button>
          </div>
        )}

        {/* ── Form body ────────────────────────────────────────── */}
        {!signupDone && (
        <div className="relative z-10 pt-24 pb-8 px-responsive-md mt-10">

          {/* First Name + Last Name — stacks on mobile, side-by-side on tablet+ */}
          <div className="flex flex-col md:flex-row gap-3 mb-4">
            <div className="flex-1 min-w-0">
              <label className="block text-[#7B3F00] font-bold text-[0.85rem] mb-1.5">
                First Name
              </label>
              <input
                type="text"
                placeholder="First Name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={loading}
                className="w-full rounded-full bg-[#D4956A] placeholder-[#A86040] text-[#5D3A1A] font-medium px-4 py-3 shadow-[inset_0_3px_8px_rgba(93,58,26,0.35)] outline-none focus:ring-2 focus:ring-[#7B3F00]/40 text-sm disabled:opacity-60"
              />
            </div>
            <div className="flex-1 min-w-0">
              <label className="block text-[#7B3F00] font-bold text-[0.85rem] mb-1.5">
                Last Name
              </label>
              <input
                type="text"
                placeholder="Last Name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={loading}
                className="w-full rounded-full bg-[#D4956A] placeholder-[#A86040] text-[#5D3A1A] font-medium px-4 py-3 shadow-[inset_0_3px_8px_rgba(93,58,26,0.35)] outline-none focus:ring-2 focus:ring-[#7B3F00]/40 text-sm disabled:opacity-60"
              />
            </div>
          </div>

          {/* Username */}
          <label className="block text-[#7B3F00] font-bold text-[0.95rem] mb-1.5">
            Username
          </label>
          <input
            type="text"
            placeholder="Enter your Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
            className="w-full rounded-full bg-[#D4956A] placeholder-[#A86040] text-[#5D3A1A] font-medium px-5 py-3 mb-4 shadow-[inset_0_3px_8px_rgba(93,58,26,0.35)] outline-none focus:ring-2 focus:ring-[#7B3F00]/40 text-sm md:text-base disabled:opacity-60"
          />

          {/* Email */}
          <label className="block text-[#7B3F00] font-bold text-[0.95rem] mb-1.5">
            Email
          </label>
          <input
            type="email"
            placeholder="Enter your Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            className="w-full rounded-full bg-[#D4956A] placeholder-[#A86040] text-[#5D3A1A] font-medium px-5 py-3 mb-4 shadow-[inset_0_3px_8px_rgba(93,58,26,0.35)] outline-none focus:ring-2 focus:ring-[#7B3F00]/40 text-sm md:text-base disabled:opacity-60"
          />

          {/* Password */}
          <label className="block text-[#7B3F00] font-bold text-[0.95rem] mb-1.5">
            Password
          </label>
          <div className="relative mb-4">
            <input
              type={showPw ? 'text' : 'password'}
              placeholder="Create your Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              className="w-full rounded-full bg-[#D4956A] placeholder-[#A86040] text-[#5D3A1A] font-medium px-5 py-3 pr-12 shadow-[inset_0_3px_8px_rgba(93,58,26,0.35)] outline-none focus:ring-2 focus:ring-[#7B3F00]/40 text-sm md:text-base disabled:opacity-60"
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

          {/* Confirm Password */}
          <label className="block text-[#7B3F00] font-bold text-[0.95rem] mb-1.5">
            Confirm Password
          </label>
          <div className="relative mb-4">
            <input
              type={showCf ? 'text' : 'password'}
              placeholder="Confirm your Password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={loading}
              className="w-full rounded-full bg-[#D4956A] placeholder-[#A86040] text-[#5D3A1A] font-medium px-5 py-3 pr-12 shadow-[inset_0_3px_8px_rgba(93,58,26,0.35)] outline-none focus:ring-2 focus:ring-[#7B3F00]/40 text-sm md:text-base disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setShowCf(!showCf)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[#7B3F00] hover:text-[#5D3A1A] transition-colors"
              aria-label="Toggle confirm password visibility"
            >
              <EyeIcon open={showCf} />
            </button>
          </div>

          {/* Error message */}
          {error && (
            <p className="text-red-800 text-xs font-semibold text-center mb-3 px-2">
              {error}
            </p>
          )}

          {/* Upload Profile Photo */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
          <div className="flex flex-col sm:flex-row items-center gap-3 mb-5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              className="flex-shrink-0 bg-white text-[#5D3A1A] font-semibold text-sm rounded-full px-4 py-2 shadow border border-gray-200 hover:bg-gray-50 transition-colors leading-tight text-center disabled:opacity-60"
            >
              Upload Profile<br />Photo
            </button>
            {photo && (
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[#5D3A1A] font-medium text-sm truncate">{photo.name}</span>
                <GreenCheck />
              </div>
            )}
          </div>

          {/* SIGNUP button */}
          <div className="flex justify-center mb-5">
            <button
              type="button"
              onClick={handleSignup}
              disabled={loading}
              className="
                bg-[#2E8B2E] hover:bg-[#329932] text-white font-black uppercase
                tracking-widest text-lg md:text-xl px-8 md:px-16 py-3 rounded-full
                shadow-[0_6px_0_#1a5c1a]
                active:shadow-[0_2px_0_#1a5c1a] active:translate-y-1
                transition-all disabled:opacity-60 disabled:cursor-not-allowed
              "
            >
              {loading ? 'SIGNING UP...' : 'SIGNUP'}
            </button>
          </div>

        </div>
        )}
      </div>

      {/* ── Below-card login link ─────────────────────────────────── */}
      <p className="mt-4 text-[#F5C47A] font-bold text-sm">
        Already have an Account?{' '}
        <button
          onClick={onLoginClick}
          className="text-green-400 underline font-bold hover:text-green-300 transition-colors"
        >
          Login.
        </button>
      </p>
    </div>
  );
}
