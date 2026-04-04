'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import BannerBg from '@/public/images/svgs/settingbanner.svg';
import ChangePasswordModal from '@/components/profile/ChangePasswordModal';
import { useLanguage } from '@/hooks/useLanguage';
import { useSettings, useSettingsModal, type AppSettings } from '@/hooks/useSettings';

type ProfileInfo = {
  displayName: string;
  username: string;
  email: string;
  avatarUrl: string | null;
};

function AvatarPlaceholder() {
  return (
    <div className="w-12 h-12 rounded-full bg-[#E8D0A0] flex items-center justify-center">
      <svg viewBox="0 0 100 100" className="w-7 h-7 text-[#C49A6C]" fill="currentColor" aria-hidden>
        <circle cx="50" cy="33" r="22" />
        <ellipse cx="50" cy="85" rx="32" ry="22" />
      </svg>
    </div>
  );
}

export default function SettingsModal() {
  const router = useRouter();
  const { t } = useLanguage();
  const { settings, updateSetting } = useSettings();
  const { isOpen, closeSettings } = useSettingsModal();

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarCacheKey, setAvatarCacheKey] = useState<number>(Date.now());
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [recentUpdate, setRecentUpdate] = useState<string | null>(null);
  const [shouldRender, setShouldRender] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      window.requestAnimationFrame(() => setIsVisible(true));
      return;
    }

    setIsVisible(false);
    hideTimerRef.current = window.setTimeout(() => setShouldRender(false), 180);
    return () => {
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    closeBtnRef.current?.focus();

    function handleEsc(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeSettings();
      }
    }

    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, closeSettings]);

  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    async function loadProfile() {
      setLoadingProfile(true);

      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        if (mounted) {
          setProfile(null);
          setLoadingProfile(false);
        }
        return;
      }

      const { data: profileRow } = await supabase
        .from('profiles')
        .select('first_name, last_name, username, avatar_url')
        .eq('auth_user_id', user.id)
        .maybeSingle();

      if (!mounted) return;

      const fullName = [profileRow?.first_name, profileRow?.last_name].filter(Boolean).join(' ').trim();
      const nextProfile = {
        displayName: fullName || profileRow?.username || user.email || 'Learner',
        username: profileRow?.username ?? '',
        email: user.email ?? '-',
        avatarUrl: profileRow?.avatar_url ?? null,
      };
      setProfile(nextProfile);
      setUsernameDraft(nextProfile.username || nextProfile.displayName);
      setEmailDraft(nextProfile.email);
      setAvatarFile(null);
      setAvatarPreview(null);
      setAvatarCacheKey(Date.now());
      setLoadingProfile(false);
    }

    void loadProfile();
    return () => {
      mounted = false;
    };
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  function markSaved(labelKey: string) {
    setRecentUpdate(labelKey);
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = window.setTimeout(() => setRecentUpdate(null), 1200);
  }

  function applySetting<K extends keyof AppSettings>(key: K, value: AppSettings[K], labelKey: string) {
    updateSetting(key, value);
    markSaved(labelKey);
  }

  async function saveProfile() {
    if (!profile) {
      setEditingProfile(false);
      return;
    }

    const trimmedUsername = usernameDraft.trim();
    const trimmedEmail = emailDraft.trim();

    if (!trimmedUsername || !trimmedEmail) {
      setProfileError(t('settings.profileFieldsRequired'));
      return;
    }

    if (!trimmedEmail.includes('@')) {
      setProfileError(t('settings.invalidEmail'));
      return;
    }

    setSavingProfile(true);
    setProfileError(null);
    let hasError = false;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSavingProfile(false);
      setProfileError(t('settings.profileUpdateFailed'));
      return;
    }

    let nextAvatarUrl = profile.avatarUrl;

    if (avatarFile) {
      const ext = avatarFile.name.split('.').pop() || 'jpg';
      const filePath = `${user.id}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, avatarFile, { contentType: avatarFile.type, upsert: true });

      if (!uploadError) {
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
        nextAvatarUrl = urlData.publicUrl;
      } else {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;

        if (!accessToken) {
          hasError = true;
          setProfileError(uploadError.message || t('settings.profileUpdateFailed'));
        } else {
          const fd = new FormData();
          fd.append('photo', avatarFile);

          const fallbackRes = await fetch('/api/profile-avatar', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            body: fd,
          });

          if (!fallbackRes.ok) {
            const fallbackData = (await fallbackRes.json().catch(() => ({}))) as { error?: string };
            hasError = true;
            setProfileError(fallbackData.error || uploadError.message || t('settings.profileUpdateFailed'));
          } else {
            const fallbackData = (await fallbackRes.json()) as { avatarUrl?: string };
            nextAvatarUrl = fallbackData.avatarUrl ?? nextAvatarUrl;
          }
        }
      }
    }

    const profileUpdatePayload: { username?: string; avatar_url?: string | null } = {};
    if (trimmedUsername !== (profile.username || '')) {
      profileUpdatePayload.username = trimmedUsername;
    }
    if (nextAvatarUrl !== profile.avatarUrl) {
      profileUpdatePayload.avatar_url = nextAvatarUrl;
    }

    if (Object.keys(profileUpdatePayload).length > 0) {
      const { error: profileUpdateError } = await supabase
        .from('profiles')
        .update(profileUpdatePayload)
        .eq('auth_user_id', user.id);

      if (profileUpdateError) {
        hasError = true;
        setProfileError(t('settings.profileUpdateFailed'));
      }
    }

    if (trimmedEmail !== profile.email) {
      const { error: emailError } = await supabase.auth.updateUser({ email: trimmedEmail });
      if (emailError) {
        hasError = true;
        setProfileError(emailError.message || t('settings.profileUpdateFailed'));
      }
    }

    if (!hasError) {
      const avatarUpdated = nextAvatarUrl !== profile.avatarUrl;
      setProfile((prev) => prev ? {
        ...prev,
        username: trimmedUsername,
        displayName: trimmedUsername,
        email: trimmedEmail,
        avatarUrl: nextAvatarUrl,
      } : prev);
      setAvatarFile(null);
      setAvatarPreview(null);
      if (avatarUpdated) {
        setAvatarCacheKey(Date.now());
      }
      markSaved('settings.profileSaved');
      setEditingProfile(false);
    }

    setSavingProfile(false);
  }

  function cancelProfileEdit() {
    setUsernameDraft(profile?.username || profile?.displayName || '');
    setEmailDraft(profile?.email ?? '');
    setAvatarFile(null);
    setAvatarPreview(null);
    setProfileError(null);
    setEditingProfile(false);
  }

  function startProfileEdit() {
    setUsernameDraft(profile?.username || profile?.displayName || '');
    setEmailDraft(profile?.email ?? '');
    setAvatarFile(null);
    setAvatarPreview(null);
    setProfileError(null);
    setEditingProfile(true);
  }

  function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setAvatarFile(file);

    if (!file) {
      setAvatarPreview(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setAvatarPreview(typeof reader.result === 'string' ? reader.result : null);
    };
    reader.readAsDataURL(file);
  }

  function openPasswordChange() {
    closeSettings();
    setShowChangePassword(true);
  }

  async function handleLogout() {
    if (!window.confirm(t('settings.logoutConfirm'))) return;
    await supabase.auth.signOut();
    closeSettings();
    router.replace('/');
  }

  if (!shouldRender && !showChangePassword) return null;

  return (
    <>
      <div
        className={`fixed inset-0 z-[10000] flex items-center justify-center px-4 transition-opacity duration-200 ${
          isVisible ? 'bg-black/45 opacity-100' : 'bg-black/0 opacity-0 pointer-events-none'
        }`}
        onClick={closeSettings}
        aria-hidden={!isOpen}
      >
        <div
          className={`relative w-full max-w-[500px] aspect-[570/681] overflow-hidden rounded-[26px] shadow-[0_10px_24px_rgba(0,0,0,0.3)] transition-all duration-200 ${
            isVisible ? 'translate-y-0 scale-100' : 'translate-y-2 scale-95'
          }`}
          role="dialog"
          aria-modal="true"
          aria-label={t('common.settings')}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="pointer-events-none absolute inset-0">
            <Image
              src={BannerBg}
              alt=""
              fill
              priority
              aria-hidden
              className="object-contain"
            />
          </div>

          <div className="relative z-10 flex h-full flex-col px-6 pt-12 pb-7 sm:px-7 sm:pt-14 sm:pb-8">
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-2xl sm:text-3xl font-black text-[#7B3F00] leading-none">
              {t('settings.title')}
            </h2>
            <button
              ref={closeBtnRef}
              onClick={closeSettings}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-[#E53935] text-xl leading-none font-black text-white shadow-[0_6px_0_#B71C1C,_0_8px_16px_rgba(0,0,0,0.28)] transition-transform hover:scale-105 active:translate-y-[2px] active:shadow-[0_3px_0_#B71C1C,_0_5px_10px_rgba(0,0,0,0.22)]"
              aria-label={t('settings.closeSettings')}
            >
              X
            </button>
          </div>

          {recentUpdate && (
            <p className="mb-3 text-xs font-bold text-[#2E7D1C]" aria-live="polite">
              {t('settings.saved')}: {t(recentUpdate)}
            </p>
          )}

          <div className="settings-scrollbar mt-1.5 min-h-0 max-h-[62%] sm:max-h-[64%] overflow-y-auto pr-1 space-y-2">
            <section className="rounded-xl border-2 border-[#7B3F00] px-3.5 py-2.5">
              <h3 className="mb-2 font-black text-[#4A2C0A]">{t('settings.languageSection')}</h3>
              <label className="block">
                <select
                  value={settings.language}
                  onChange={(event) =>
                    applySetting('language', event.target.value as AppSettings['language'], 'common.languageLabel')
                  }
                  className="w-full rounded-lg border border-[#BF7B45] bg-white px-3 py-2 font-medium text-[#4A2C0A] outline-none"
                >
                  <option value="en">{t('settings.languageEnglish')}</option>
                  <option value="tl">{t('settings.languageTagalog')}</option>
                </select>
              </label>
            </section>

            <section className="rounded-xl border-2 border-[#7B3F00] px-3 py-2 space-y-2">
              <h3 className="font-black text-[#4A2C0A]">{t('settings.audioSection')}</h3>
              <label className="flex items-center justify-between">
                <span className="font-medium text-[#4A2C0A]">{t('settings.soundEffectsLabel')}</span>
                <input
                  type="checkbox"
                  checked={settings.soundEffects}
                  onChange={(event) => applySetting('soundEffects', event.target.checked, 'settings.soundEffectsLabel')}
                  className="h-5 w-5 accent-[#33AA11] bg-white"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="font-medium text-[#4A2C0A]">{t('settings.backgroundMusicLabel')}</span>
                <input
                  type="checkbox"
                  checked={settings.backgroundMusic}
                  onChange={(event) =>
                    applySetting('backgroundMusic', event.target.checked, 'settings.backgroundMusicLabel')
                  }
                  className="h-5 w-5 accent-[#33AA11] bg-white"
                />
              </label>
            </section>

            <section className="rounded-xl border-2 border-[#7B3F00] px-3 py-2">
              <h3 className="mb-2 font-black text-[#4A2C0A]">{t('settings.profileSection')}</h3>
              {loadingProfile ? (
                <p className="text-sm font-medium text-[#7B3F00]">{t('common.loading')}</p>
              ) : profile ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    {(avatarPreview || profile.avatarUrl) ? (
                      <Image
                        src={avatarPreview || (profile.avatarUrl ? `${profile.avatarUrl}${profile.avatarUrl.includes('?') ? '&' : '?'}v=${avatarCacheKey}` : '')}
                        alt={t('settings.profileAvatarAlt')}
                        width={48}
                        height={48}
                        className="w-12 h-12 rounded-full object-cover border border-[#BF7B45]"
                      />
                    ) : (
                      <AvatarPlaceholder />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-[#4A2C0A] truncate">{profile.displayName}</p>
                      <p className="text-xs font-medium text-[#7B3F00] truncate">{profile.email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => (editingProfile ? cancelProfileEdit() : startProfileEdit())}
                      className="rounded-full bg-[#FF9900] border-2 border-[#FF9900] text-white text-xs font-black px-3 py-1.5 shadow-[0_3px_0_#B86A00]"
                    >
                      {editingProfile ? t('settings.cancel') : t('settings.editProfile')}
                    </button>
                  </div>

                  {editingProfile && (
                    <div className="rounded-xl border-2 border-[#7B3F00] p-3 space-y-3">
                      <label className="block">
                        <span className="mb-1 block text-sm font-bold text-[#4A2C0A]">{t('settings.usernameLabel')}</span>
                        <input
                          type="text"
                          value={usernameDraft}
                          onChange={(event) => setUsernameDraft(event.target.value)}
                          className="w-full rounded-lg border border-[#BF7B45] bg-white px-3 py-2 font-semibold text-[#4A2C0A] outline-none"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-sm font-bold text-[#4A2C0A]">{t('settings.emailLabel')}</span>
                        <input
                          type="email"
                          value={emailDraft}
                          onChange={(event) => setEmailDraft(event.target.value)}
                          className="w-full rounded-lg border border-[#BF7B45] bg-white px-3 py-2 font-semibold text-[#4A2C0A] outline-none"
                        />
                      </label>

                      <div className="space-y-1">
                        <span className="block text-sm font-bold text-[#4A2C0A]">{t('settings.profilePictureLabel')}</span>
                        <input
                          ref={photoInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleAvatarChange}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => photoInputRef.current?.click()}
                          className="rounded-full bg-[#4C8EF7] border-2 border-[#4C8EF7] text-white text-xs font-black px-3 py-1.5 shadow-[0_3px_0_#2a5fb6]"
                        >
                          {t('settings.choosePhoto')}
                        </button>
                        {avatarFile && (
                          <p className="text-xs font-medium text-[#7B3F00]">{t('settings.selectedFile')}: {avatarFile.name}</p>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={openPasswordChange}
                        className="w-full rounded-full bg-[#4C8EF7] border-2 border-[#4C8EF7] text-white text-xs font-black px-3 py-1.5 shadow-[0_3px_0_#2a5fb6]"
                      >
                        {t('settings.changePasswordButton')}
                      </button>

                      {profileError && (
                        <p className="text-xs font-medium text-red-700">{profileError}</p>
                      )}

                      <div className="flex gap-2 justify-end">
                        <button
                          type="button"
                          onClick={cancelProfileEdit}
                          disabled={savingProfile}
                          className="rounded-full bg-gray-400 text-white text-xs font-black px-3 py-1.5 shadow-[0_3px_0_#6b7280] disabled:opacity-60"
                        >
                          {t('settings.cancel')}
                        </button>
                        <button
                          type="button"
                          onClick={saveProfile}
                          disabled={savingProfile}
                          className="rounded-full bg-[#33AA11] border-[3px] border-[#33AA11] text-white text-xs font-black px-3 py-1.5 shadow-[0_3px_0_#165c00] disabled:opacity-60"
                        >
                          {savingProfile ? t('settings.updating') : t('settings.saveProfile')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm font-medium text-[#7B3F00]">{t('settings.notSignedIn')}</p>
              )}
            </section>

          </div>

          <div className="mt-auto shrink-0 pt-4 pb-2">
            <div className="mx-auto flex w-full max-w-[320px] items-center justify-between gap-3 px-1">
              <button
                type="button"
                onClick={handleLogout}
                className="w-[150px] rounded-full bg-[#E53935] border-2 border-[#E53935] text-white text-sm font-black px-4 py-2 shadow-[0_3px_0_#B71C1C]"
              >
                {t('settings.logOut')}
              </button>

              <button
                type="button"
                onClick={closeSettings}
                className="w-[150px] rounded-full bg-[#33AA11] border-2 border-[#33AA11] text-white text-sm font-black px-4 py-2 shadow-[0_3px_0_#165c00]"
              >
                {t('settings.done')}
              </button>
            </div>
          </div>
          </div>
        </div>
      </div>

      {showChangePassword && (
        <ChangePasswordModal
          onClose={() => setShowChangePassword(false)}
          onSuccess={() => setShowChangePassword(false)}
        />
      )}
    </>
  );
}
