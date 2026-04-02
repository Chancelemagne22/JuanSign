'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type LanguageCode = 'en' | 'tl';

const STORAGE_KEY = 'juansign.language';

const languageLabels: Record<LanguageCode, string> = {
  en: 'English',
  tl: 'Tagalog',
};

const dictionary: Record<LanguageCode, Record<string, string>> = {
  en: {
    'common.loading': 'Loading...',
    'common.goBack': 'Go Back',
    'common.settings': 'Settings',
    'common.languageLabel': 'Language',

    'settings.openSettings': 'Open settings',
    'settings.logOut': 'Log out',
    'settings.selectSiteLanguage': 'Select site language',

    'settings.currentPasswordRequired': 'Please enter your current password.',
    'settings.newPasswordRequired': 'Please enter a new password.',
    'settings.minPasswordLength': 'Password must be at least 6 characters long.',
    'settings.passwordsDoNotMatch': 'Passwords do not match.',
    'settings.passwordMustDiffer': 'New password must be different from current password.',
    'settings.verifyAccountFailed': 'Failed to verify account. Please log in again.',
    'settings.currentPasswordIncorrect': 'Current password is incorrect.',
    'settings.updatePasswordFailed': 'Failed to update password. Please try again.',
    'settings.unexpectedError': 'An unexpected error occurred. Please try again.',
    'settings.changePasswordTitle': 'Change Password',
    'settings.passwordChangedSuccess': 'Password changed successfully!',
    'settings.currentPasswordLabel': 'Current Password',
    'settings.currentPasswordPlaceholder': 'Enter current password',
    'settings.newPasswordLabel': 'New Password',
    'settings.newPasswordPlaceholder': 'Enter new password',
    'settings.confirmNewPasswordLabel': 'Confirm New Password',
    'settings.confirmNewPasswordPlaceholder': 'Confirm new password',
    'settings.passwordRequirements': 'Password must be at least 6 characters and match confirmation.',
    'settings.cancel': 'Cancel',
    'settings.updating': 'Updating...',
    'settings.success': 'Success',
    'settings.changePasswordButton': 'Change Password',

    'practicePage.cameraAccessDenied': 'Camera access was denied. Please allow camera permission.',

    'module.noVideoCaptured': 'No video captured. Please record again.',
    'module.niceJobSigned': 'Nice job! You signed',
    'module.correctly': 'correctly.',
    'module.notQuiteModelSaw': 'Not quite. The model saw',
    'module.sessionExpired': 'Session expired. Please log in again.',
    'module.uploadFailed': 'Upload failed. Please try again.',
    'module.recordYourSign': 'Record your sign first.',
    'module.greatUpload': 'Great! Upload complete. You can continue.',
    'module.showSignFor': 'Show the sign for',
    'module.rec': 'REC',
    'module.analyzing': 'Analyzing...',
    'module.correct': 'Correct',
    'module.tryAgain': 'Try Again',
    'module.aiSaw': 'AI saw',
    'module.dismiss': 'Dismiss',
    'module.resumeRecording': 'Resume recording',
    'module.startRecording': 'Start recording',
    'module.pauseRecording': 'Pause recording',
    'module.restartRecording': 'Restart recording',
    'module.stopRecording': 'Stop recording',
    'module.uploading': 'Uploading...',
    'module.uploadVideo': 'Upload Video',
    'module.next': 'Next',
    'module.finish': 'Finish',
  },
  tl: {},
};

function humanizeKey(key: string): string {
  const leaf = key.includes('.') ? key.split('.').at(-1) ?? key : key;
  const pretty = leaf
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();

  if (!pretty) return key;
  return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}

export function useLanguage() {
  const [language, setLanguageState] = useState<LanguageCode>('en');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'tl') {
      setLanguageState(stored);
    }
  }, []);

  const setLanguage = useCallback((next: LanguageCode) => {
    setLanguageState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  const t = useCallback(
    (key: string) => {
      return dictionary[language][key] ?? dictionary.en[key] ?? humanizeKey(key);
    },
    [language]
  );

  return useMemo(
    () => ({
      language,
      setLanguage,
      t,
      supportedLanguages: ['en', 'tl'] as LanguageCode[],
      languageLabels,
    }),
    [language, setLanguage, t]
  );
}
