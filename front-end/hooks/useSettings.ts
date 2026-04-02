'use client';

import { useCallback, useEffect, useState } from 'react';

type SettingLanguage = 'en' | 'tl';

export type AppSettings = {
  soundEffects: boolean;
  backgroundMusic: boolean;
  language: SettingLanguage;
  showTimer: boolean;
  confirmSubmit: boolean;
  reviewBeforeSubmit: boolean;
  showCaptions: boolean;
  autoplayLesson: boolean;
  playbackSpeed: 0.75 | 1 | 1.25 | 1.5;
  shuffleQuestions: boolean;
  showCorrectAnswer: boolean;
};

const STORAGE_KEY = 'juansign.settings';

const defaultSettings: AppSettings = {
  soundEffects: true,
  backgroundMusic: true,
  language: 'en',
  showTimer: true,
  confirmSubmit: true,
  reviewBeforeSubmit: true,
  showCaptions: true,
  autoplayLesson: false,
  playbackSpeed: 1,
  shuffleQuestions: false,
  showCorrectAnswer: true,
};

function parsePlaybackSpeed(value: unknown): AppSettings['playbackSpeed'] {
  return value === 0.75 || value === 1 || value === 1.25 || value === 1.5 ? value : 1;
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      setSettings({
        soundEffects:
          typeof parsed.soundEffects === 'boolean' ? parsed.soundEffects : defaultSettings.soundEffects,
        backgroundMusic:
          typeof parsed.backgroundMusic === 'boolean' ? parsed.backgroundMusic : defaultSettings.backgroundMusic,
        language: parsed.language === 'tl' ? 'tl' : 'en',
        showTimer: typeof parsed.showTimer === 'boolean' ? parsed.showTimer : defaultSettings.showTimer,
        confirmSubmit:
          typeof parsed.confirmSubmit === 'boolean' ? parsed.confirmSubmit : defaultSettings.confirmSubmit,
        reviewBeforeSubmit:
          typeof parsed.reviewBeforeSubmit === 'boolean'
            ? parsed.reviewBeforeSubmit
            : defaultSettings.reviewBeforeSubmit,
        showCaptions:
          typeof parsed.showCaptions === 'boolean' ? parsed.showCaptions : defaultSettings.showCaptions,
        autoplayLesson:
          typeof parsed.autoplayLesson === 'boolean'
            ? parsed.autoplayLesson
            : defaultSettings.autoplayLesson,
        playbackSpeed: parsePlaybackSpeed(parsed.playbackSpeed),
        shuffleQuestions:
          typeof parsed.shuffleQuestions === 'boolean'
            ? parsed.shuffleQuestions
            : defaultSettings.shuffleQuestions,
        showCorrectAnswer:
          typeof parsed.showCorrectAnswer === 'boolean'
            ? parsed.showCorrectAnswer
            : defaultSettings.showCorrectAnswer,
      });
    } catch {
      setSettings(defaultSettings);
    }
  }, []);

  const updateSetting = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        }
        return next;
      });
    },
    []
  );

  return { settings, updateSetting };
}
