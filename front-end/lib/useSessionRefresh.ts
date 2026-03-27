'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * useSessionRefresh
 * 
 * Automatically refreshes the JWT token silently to prevent mid-session logouts.
 * Runs on app mount and subscribes to auth state changes.
 * 
 * This ensures users stay logged in for as long as their browser session is active,
 * even if their JWT is about to expire.
 */
export function useSessionRefresh() {
  useEffect(() => {
    async function refreshSession() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        // Attempt to refresh the JWT token
        const { data: refreshedSession, error } = await supabase.auth.refreshSession();
        if (error) {
          console.warn('[useSessionRefresh] Failed to refresh session:', error.message);
        } else {
          console.log('[useSessionRefresh] Session refreshed successfully');
        }
      } catch (err) {
        console.error('[useSessionRefresh] Unexpected error:', err);
      }
    }

    // Refresh on mount
    refreshSession();

    // Subscribe to auth state changes (e.g., token expiry, logout)
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'TOKEN_REFRESHED') {
          console.log('[useSessionRefresh] Token automatically refreshed by Supabase SDK');
        } else if (event === 'SIGNED_OUT') {
          console.log('[useSessionRefresh] User signed out');
        }
      }
    );

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);
}
