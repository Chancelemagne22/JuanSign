'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import WoodArc from '@/public/images/svgs/arc.svg';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/hooks/useLanguage';
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
  const { t } = useLanguage();
  const [username,    setUsername]    = useState(user.username);
  const [newPassword, setNewPassword] = useState('');
  const [editingUser, setEditingUser] = useState(false);
  const [editingPw,   setEditingPw]   = useState(false);
  const [saving,      setSaving]      = useState(false);

  useEffect(() => {
    function blockEscapeClose(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
    }

    window.addEventListener('keydown', blockEscapeClose, true);
    return () => window.removeEventListener('keydown', blockEscapeClose, true);
  }, []);

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
    >
      {/* ── Card ─────────────────────────────────────────────────── */}
      <div
        className="relative w-full max-w-[800px] rounded-[38px]"
        style={{
          backgroundImage: 'url(/images/svgs/banner.svg)',
          backgroundSize: 'contain',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Arc.svg — "USER PROFILE" sign ───────────────────────────── */}
        <div className="absolute left-1/2 w-[85%] max-w-[220px]"
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
              width={448}
              height={126}
              className="w-full h-auto"
              aria-hidden
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <p
                className="text-white font-black uppercase tracking-[0.25em] text-[clamp(0.75rem,3vw,1.1rem)] leading-none"
                style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}
              >
                {t('profile.title')}
              </p>
            </div>
          </div>
        </div>

        {/* ── Body ─────────────────────────────────────────────── */}
        <div className="relative z-10 pt-15 pb-10  px-5 flex flex-col gap-3 max-w-[220px] mx-auto w-full">

          {/* Top row: photo + editable fields */}
          <div className="flex gap-3 mb-4 justify-center items-center">

            {/* Profile photo */}
            <div className="flex-shrink-0 w-[80px] h-[100px] rounded-xl border-3 border-[#8B5E3C] overflow-hidden bg-white shadow-inner">
              {user.photoUrl ? (
                <Image
                  src={user.photoUrl}
                  alt={t('profile.profilePhotoAlt')}
                  width={80}
                  height={100}
                  className="w-full h-full object-cover"
                />
              ) : (
                <AvatarPlaceholder />
              )}
            </div>

            {/* Username + Password rows */}
            <div className="flex flex-col justify-center gap-2 max-w-[120px]">

              {/* Username */}
              <div>
                <p className="text-[#7B3F00] font-bold text-xs mb-0.5">{t('profile.username')}</p>
                <div className="flex items-center bg-[#D4956A] rounded-full px-2.5 py-1 gap-1">
                  <input
                    type="text"
                    value={username}
                    readOnly={!editingUser}
                    onChange={(e) => setUsername(e.target.value)}
                    onBlur={saveUsername}
                    onKeyDown={(e) => e.key === 'Enter' && saveUsername()}
                    className="flex-1 bg-transparent text-[#5D3A1A] font-semibold text-xs outline-none ring-0 focus:outline-none focus:ring-0 min-w-0"
                  />
                  <button
                    onClick={() => setEditingUser(true)}
                    disabled={saving}
                    className="text-[#7B3F00] hover:text-[#5D3A1A] transition-colors flex-shrink-0 disabled:opacity-50"
                    aria-label={t('profile.editUsername')}
                  >
                    <PencilIcon />
                  </button>
                </div>
              </div>

              {/* Password */}
              <div>
                <p className="text-[#7B3F00] font-bold text-xs mb-0.5">{t('profile.password')}</p>
                <div className="flex items-center bg-[#D4956A] rounded-full px-2.5 py-1 gap-1">
                  <input
                    type={editingPw ? 'text' : 'password'}
                    placeholder={editingPw ? t('profile.newPasswordPlaceholder') : ''}
                    value={editingPw ? newPassword : '••••••••'}
                    readOnly={!editingPw}
                    onChange={(e) => setNewPassword(e.target.value)}
                    onBlur={savePassword}
                    onKeyDown={(e) => e.key === 'Enter' && savePassword()}
                    className="flex-1 bg-transparent text-[#5D3A1A] font-semibold text-xs outline-none ring-0 focus:outline-none focus:ring-0 min-w-0"
                  />
                  <button
                    onClick={() => { setEditingPw(true); setNewPassword(''); }}
                    disabled={saving}
                    className="text-[#7B3F00] hover:text-[#5D3A1A] transition-colors flex-shrink-0 disabled:opacity-50"
                    aria-label={t('profile.changePassword')}
                  >
                    <PencilIcon />
                  </button>
                </div>
              </div>

            </div>
          </div>

          {/* Stats */}
          <div className="flex flex-col items-center gap-1 mb-3 text-[#5D3A1A] font-bold text-xs">
            <p>
              {t('profile.starObtained')}:{' '}
              <span className="inline-flex items-center gap-1">
                <span>⭐</span>
                <span className="text-[#E8A020]">{user.stars}</span>
              </span>
            </p>
            <p>{t('profile.currentLevel')}:&nbsp;&nbsp; {t('profile.levelLabel')} {user.level}</p>
            <p>{t('profile.completionRate')}:&nbsp; {user.completionRate}%</p>
          </div>

          {/* CONTINUE button */}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={onContinue}
              className="
                bg-[#2E8B2E] hover:bg-[#329932] text-white font-black uppercase
                tracking-wider text-sm px-8 py-2 rounded-full
                shadow-[0_4px_0_#1a5c1a]
                active:shadow-[0_2px_0_#1a5c1a] active:translate-y-1
                transition-all
              "
            >
              {t('profile.continue')}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
