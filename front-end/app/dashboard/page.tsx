'use client';

// PAGE: Dashboard Menu
// ROUTE: /dashboard
// Entry point after login. Shows 3 mode buttons: Lessons, Practice, Assessment.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import GearIcon from '@/public/images/svgs/gear-icon.svg';
import ChangePasswordModal from '@/components/profile/ChangePasswordModal';
import { useLanguage } from '@/hooks/useLanguage';

export default function Dashboard() {
  const router = useRouter();
  const { t } = useLanguage();
  const [displayName, setDisplayName] = useState('');
  const [showChangePassword, setShowChangePassword] = useState(false);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/'); return; }

      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, username')
        .eq('auth_user_id', user.id)
        .single();

      setDisplayName(profile?.first_name ?? profile?.username ?? 'Learner');
    }
    init();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/');
  };

  const modes = [
    { label: t('dashboard.lessons'),    path: '/dashboard/lessons',    bg: '#009B01', shadow: '#005501', border: '#009B01', text: '#FFFFFF', weight: 400 },
    { label: t('dashboard.practice'),   path: '/dashboard/practice',   bg: '#FAA200', shadow: '#D85600', border: '#FAA200', text: '#FFFFFF', weight: 400 },
    { label: t('dashboard.assessment'), path: '/dashboard/assessment', bg: '#FF0000', shadow: '#BD0000', border: '#FF0000', text: '#FFFFFF', weight: 400 },
  ];

  return (
    <div className="min-h-screen bg-white px-6 pt-5 pb-12">

      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-10">
        <button
          onClick={handleLogout}
          className="
            bg-[#E53935] hover:bg-[#D32F2F] text-white font-black uppercase
            tracking-widest text-xs px-4 py-2 rounded-full
            shadow-[0_4px_0_#b71c1c,0_6px_12px_rgba(0,0,0,0.2)]
            active:shadow-[0_1px_0_#b71c1c,0_2px_6px_rgba(0,0,0,0.15)] active:translate-y-1
            transition-all
          "
          aria-label={t('settings.logOut')}
        >
          {t('dashboard.logout')}
        </button>

        <button
          onClick={() => setShowChangePassword(true)}
          className="flex items-center justify-center flex-shrink-0 transition-transform"
          style={{
            zIndex: 9999,
            width: 'clamp(36px, 6vw, 44px)',
            height: 'clamp(36px, 6vw, 44px)',
            borderRadius: '50%',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            background: 'linear-gradient(180deg, #ffcc44 0%, #ff9900 100%)',
            boxShadow: '0 6px 0 #b86a00, 0 8px 16px rgba(0, 0, 0, 0.3)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.1)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'translateY(4px) scale(0.96)', e.currentTarget.style.boxShadow = '0 2px 0 #b86a00, 0 4px 8px rgba(0, 0, 0, 0.2)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1.1)', e.currentTarget.style.boxShadow = '0 6px 0 #b86a00, 0 8px 16px rgba(0, 0, 0, 0.3)')}
          aria-label={t('settings.openSettings')}
        >
          <Image src={GearIcon} alt="" style={{ width: '50%', height: '50%' }} />
        </button>
      </div>

      {/* ── Welcome heading ───────────────────────────────────────── */}
      <div className="text-center mb-14">
        <h1
          className="heading-xl"
          style={{
            fontFamily:       'var(--font-spicy-rice)',
            color:            '#0077F8',
            WebkitTextStroke: '1px #152978',
            textShadow:       '1px 1px 0 #152978',
          }}
        >
          {t('dashboard.welcomeBack').replace('{{name}}', displayName)}
        </h1>
        <p className="text-[#4A2C0A] font-bold text-base sm:text-lg mt-0.5">
          {t('dashboard.prompt')}
        </p>
      </div>

      {/* ── Mode buttons ──────────────────────────────────────────── */}
      <div className="flex flex-col gap-5 max-w-sm mx-auto px-4 sm:px-0">
        {modes.map(({ label, path, bg, shadow, border, text, weight }) => (
          <button
            key={label}
            onClick={() => router.push(path)}
            className="
              w-full py-5 rounded-full
              border-[4px]
              text-2xl sm:text-3xl lg:text-4xl
              active:translate-y-1
              transition-transform hover:brightness-90
            "
            style={{
              fontFamily: 'var(--font-spicy-rice)',
              fontWeight: weight,
              backgroundColor: bg,
              borderColor: border,
              color: text,
              boxShadow: `0 6px 0 ${shadow}`,
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.boxShadow = `0 1px 0 ${shadow}`;
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.boxShadow = `0 6px 0 ${shadow}`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = `0 6px 0 ${shadow}`;
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Change Password Modal ──────────────────────────────────── */}
      {showChangePassword && (
        <ChangePasswordModal
          onClose={() => setShowChangePassword(false)}
          onSuccess={() => setShowChangePassword(false)}
        />
      )}

    </div>
  );
}
