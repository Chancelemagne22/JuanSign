'use client';

import { useEffect, ReactNode, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface AuthGuardProps {
  children: ReactNode;
  fallback?: ReactNode; // Optional loading fallback
}

export default function AuthGuard({ children, fallback }: AuthGuardProps) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();

      if (!mounted) return;

      if (!session) {
        console.warn('[AuthGuard] No active session, redirecting to /');
        router.replace('/');
        return;
      }

      setChecking(false);
    }

    void checkAuth();

    // Subscribe to auth state changes
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!session) {
          console.warn('[AuthGuard] Session lost, redirecting to /');
          router.replace('/');
          return;
        }

        if (mounted) setChecking(false);
      }
    );

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, [router]);

  if (checking) {
    return (
      <>
        {fallback ?? (
          <div className="min-h-screen flex items-center justify-center bg-white">
            <p className="text-[#7B3F00] font-bold text-base">Checking session...</p>
          </div>
        )}
      </>
    );
  }

  return <>{children}</>;
}
