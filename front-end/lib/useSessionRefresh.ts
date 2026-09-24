'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

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
          logger.warn('session', 'refresh_failed', { reason: error.message });
        } else {
          logger.debug('session', 'refreshed');
        }
      } catch (err) {
        logger.error('session', 'refresh_error', { reason: err instanceof Error ? err.message : String(err) });
      }
    }

    // Refresh on mount
    refreshSession();

    // Subscribe to auth state changes (e.g., token expiry, logout)
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'TOKEN_REFRESHED') {
          logger.debug('session', 'token_refreshed');
        } else if (event === 'SIGNED_OUT') {
          logger.debug('session', 'signed_out');
        }
      }
    );

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);
}
