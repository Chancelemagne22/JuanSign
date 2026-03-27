'use client';

import { useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface AuthGuardProps {
  children: ReactNode;
  fallback?: ReactNode; // Optional loading fallback
}

export default function AuthGuard({ children, fallback }: AuthGuardProps) {
  const router = useRouter();

  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        console.warn('[AuthGuard] No active session, redirecting to /');
        router.replace('/');
      }
    }

    checkAuth();

    // Subscribe to auth state changes
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!session) {
          console.warn('[AuthGuard] Session lost, redirecting to /');
          router.replace('/');
        }
      }
    );

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, [router]);

  return <>{children}</>;
}
