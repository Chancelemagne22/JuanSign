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

export default function Dashboard() {
  const router = useRouter();
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

  const modes = [
    { label: 'Lessons',    path: '/dashboard/lessons'    },
    { label: 'Practice',   path: '/dashboard/practice'   },
    { label: 'Assessment', path: '/dashboard/assessment' },
  ];

  return (
    <div className="min-h-screen bg-white px-6 pt-5 pb-12">

      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-10">
        <button
          onClick={() => router.replace('/')}
           className="icon-circle-btn"
          aria-label="Back to home"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor" aria-hidden>
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>

        <button
          onClick={() => setShowChangePassword(true)}
           className="icon-circle-btn"
          aria-label="Settings"
        >
          <Image src={GearIcon} alt="" width={22} height={22} aria-hidden />
        </button>
      </div>

      {/* ── Welcome heading ───────────────────────────────────────── */}
      <div className="text-center mb-14">
        <h1
          className="heading-xl"
          style={{
            fontFamily:       'var(--font-spicy-rice)',
            color:            '#2E7D1C',
            WebkitTextStroke: '1px #1a4d10',
            textShadow:       '1px 1px 0 #1a4d10',
          }}
        >
          Welcome back, {displayName}!
        </h1>
        <p className="text-[#4A2C0A] font-bold text-base mt-2">
          What would you like to do today?
        </p>
      </div>

      {/* ── Mode buttons ──────────────────────────────────────────── */}
      <div className="flex flex-col gap-5 max-w-sm mx-auto px-4 sm:px-0">
        {modes.map(({ label, path }) => (
          <button
            key={label}
            onClick={() => router.push(path)}
            className="
              w-full py-5 rounded-full
              bg-[#E8A87C] border-[4px] border-[#BF7B45]
              text-[#4A2C0A] font-black text-2xl sm:text-3xl lg:text-4xl
              shadow-[0_6px_0_#8B6040]
              active:translate-y-1 active:shadow-[0_1px_0_#8B6040]
              transition-transform hover:brightness-90
            "
            style={{ fontFamily: 'var(--font-spicy-rice)' }}
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
