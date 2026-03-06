'use client';

import { useState } from 'react';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import type { UserData } from '@/types/user';

/* Pencil / edit icon */
function PencilIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
    </svg>
  );
}

/* Person silhouette — shown when no profile photo has been uploaded */
function AvatarPlaceholder() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-[#E8D0A0]">
      <svg viewBox="0 0 100 100" className="w-3/4 h-3/4 text-[#C49A6C]" fill="currentColor">
        <circle cx="50" cy="33" r="22" />
        <ellipse cx="50" cy="85" rx="32" ry="22" />
      </svg>
    </div>
  );
}

interface Props {
  user: UserData;
  onContinue: () => void;
  onClose: () => void;
}

export default function UserProfileModal({ user, onContinue, onClose }: Props) {
  const [username,    setUsername]    = useState(user.username);
  const [newPassword, setNewPassword] = useState('');
  const [editingUser, setEditingUser] = useState(false);
  const [editingPw,   setEditingPw]   = useState(false);
  const [saving,      setSaving]      = useState(false);

  async function saveUsername() {
    setEditingUser(false);
    const trimmed = username.trim();
    if (!trimmed || trimmed === user.username) return;
    setSaving(true);
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (authUser) {
      await supabase
        .from('profiles')
        .update({ username: trimmed })
        .eq('auth_user_id', authUser.id);
    }
    setSaving(false);
  }

  async function savePassword() {
    setEditingPw(false);
    if (!newPassword.trim()) return;
    setSaving(true);
    await supabase.auth.updateUser({ password: newPassword });
    setNewPassword('');
    setSaving(false);
  }

  return (
    /* ── Backdrop ──────────────────────────────────────────────── */
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4"
      onClick={onClose}
    >
      {/* ── Card ─────────────────────────────────────────────────── */}
      <div
        className="relative w-full max-w-[500px] rounded-3xl border-[5px] border-[#C47A3A] bg-[#F5C47A] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Banner tab ───────────────────────────────────────── */}
        <div className="absolute -top-[46px] left-1/2 -translate-x-1/2 w-[70%]">
          <div className="relative bg-[#C47A3A] rounded-2xl pt-3 pb-4 px-6 shadow-[0_4px_12px_rgba(0,0,0,0.4)]">
            <div className="absolute top-1.5 left-3 right-3 h-[2px] bg-white/20 rounded-full" />
            <p
              className="text-white text-center font-black uppercase tracking-[0.18em] text-[1.35rem] leading-none"
              style={{ textShadow: '0 2px 4px rgba(0,0,0,0.4)' }}
            >
              USER PROFILE
            </p>
          </div>
          <div className="absolute -bottom-[5px] left-4 right-4 h-3 bg-[#C47A3A] rounded-b-sm" />
        </div>

        {/* ── Body ─────────────────────────────────────────────── */}
        <div className="pt-10 pb-6 px-7">

          {/* Top row: photo + editable fields */}
          <div className="flex gap-5 mb-5">

            {/* Profile photo */}
            <div className="flex-shrink-0 w-[130px] h-[145px] rounded-2xl border-4 border-[#8B5E3C] overflow-hidden bg-white shadow-inner">
              {user.photoUrl ? (
                <Image
                  src={user.photoUrl}
                  alt="Profile photo"
                  width={130}
                  height={145}
                  className="w-full h-full object-cover"
                />
              ) : (
                <AvatarPlaceholder />
              )}
            </div>

            {/* Username + Password rows */}
            <div className="flex-1 flex flex-col justify-center gap-3">

              {/* Username */}
              <div>
                <p className="text-[#7B3F00] font-bold text-sm mb-1">Username</p>
                <div className="flex items-center bg-[#D4956A] rounded-full px-4 py-2 gap-2">
                  <input
                    type="text"
                    value={username}
                    readOnly={!editingUser}
                    onChange={(e) => setUsername(e.target.value)}
                    onBlur={saveUsername}
                    onKeyDown={(e) => e.key === 'Enter' && saveUsername()}
                    className="flex-1 bg-transparent text-[#5D3A1A] font-semibold text-sm outline-none min-w-0"
                  />
                  <button
                    onClick={() => setEditingUser(true)}
                    disabled={saving}
                    className="text-[#7B3F00] hover:text-[#5D3A1A] transition-colors flex-shrink-0 disabled:opacity-50"
                    aria-label="Edit username"
                  >
                    <PencilIcon />
                  </button>
                </div>
              </div>

              {/* Password */}
              <div>
                <p className="text-[#7B3F00] font-bold text-sm mb-1">Password</p>
                <div className="flex items-center bg-[#D4956A] rounded-full px-4 py-2 gap-2">
                  <input
                    type={editingPw ? 'text' : 'password'}
                    placeholder={editingPw ? 'Enter new password' : ''}
                    value={editingPw ? newPassword : '••••••••'}
                    readOnly={!editingPw}
                    onChange={(e) => setNewPassword(e.target.value)}
                    onBlur={savePassword}
                    onKeyDown={(e) => e.key === 'Enter' && savePassword()}
                    className="flex-1 bg-transparent text-[#5D3A1A] font-semibold text-sm outline-none min-w-0"
                  />
                  <button
                    onClick={() => { setEditingPw(true); setNewPassword(''); }}
                    disabled={saving}
                    className="text-[#7B3F00] hover:text-[#5D3A1A] transition-colors flex-shrink-0 disabled:opacity-50"
                    aria-label="Change password"
                  >
                    <PencilIcon />
                  </button>
                </div>
              </div>

            </div>
          </div>

          {/* Stats */}
          <div className="flex flex-col items-center gap-1.5 mb-6 text-[#5D3A1A] font-bold text-base">
            <p>
              Star Obtained:{' '}
              <span className="inline-flex items-center gap-1">
                <span>⭐</span>
                <span className="text-[#E8A020]">{user.stars}</span>
              </span>
            </p>
            <p>Current Level:&nbsp;&nbsp; Level {user.level}</p>
            <p>Completion Rate:&nbsp; {user.completionRate}%</p>
          </div>

          {/* CONTINUE button */}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={onContinue}
              className="
                bg-[#2E8B2E] hover:bg-[#329932] text-white font-black uppercase
                tracking-widest text-xl px-16 py-3 rounded-full
                shadow-[0_6px_0_#1a5c1a]
                active:shadow-[0_2px_0_#1a5c1a] active:translate-y-1
                transition-all
              "
            >
              CONTINUE
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
