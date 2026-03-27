'use client';

import { ReactNode } from 'react';
import { useSessionRefresh } from '@/lib/useSessionRefresh';

/**
 * SessionRefreshProvider
 * 
 * Wraps the app to provide silent JWT refresh on mount.
 * Place this in the root layout to ensure all pages benefit from session refresh.
 */
export function SessionRefreshProvider({ children }: { children: ReactNode }) {
  useSessionRefresh();
  return <>{children}</>;
}
