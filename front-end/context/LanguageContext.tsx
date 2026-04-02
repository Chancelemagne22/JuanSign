'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  languageLabels,
  supportedLanguages,
  translations,
  type LanguageCode,
  type TranslationTree,
} from '@/i18n/translations';

const STORAGE_KEY = 'juansign.language';

type LanguageContextValue = {
  language: LanguageCode;
  setLanguage: (next: LanguageCode) => void;
  t: (key: string) => string;
  supportedLanguages: LanguageCode[];
  languageLabels: Record<LanguageCode, string>;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function getFromPath(obj: TranslationTree, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (typeof current !== 'object' || current === null || !(part in current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return typeof current === 'string' ? current : undefined;
}

function getInitialLanguage(): LanguageCode {
  if (typeof window === 'undefined') return 'en';

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored && supportedLanguages.includes(stored as LanguageCode)) {
    return stored as LanguageCode;
  }

  return 'en';
}

function humanizeKey(key: string): string {
  const leaf = key.includes('.') ? key.split('.').at(-1) ?? key : key;
  const pretty = leaf
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();

  if (!pretty) return key;
  return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>('en');

  useEffect(() => {
    setLanguageState(getInitialLanguage());
  }, []);

  const setLanguage = useCallback((next: LanguageCode) => {
    setLanguageState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  const t = useCallback(
    (key: string) => {
      const active = translations[language];
      const fallback = translations.en;
      return getFromPath(active, key) ?? getFromPath(fallback, key) ?? humanizeKey(key);
    },
    [language]
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage, t, supportedLanguages, languageLabels }),
    [language, setLanguage, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within LanguageProvider.');
  }

  return ctx;
}
