'use client';

import { useLanguage } from '@/hooks/useLanguage';

type VerifyEmailPromptProps = {
  email: string;
  onResend: () => void;
  onContinue: () => void;
  isResendDisabled: boolean;
  resendSecondsLeft: number;
  feedbackMessage?: string | null;
  errorMessage?: string | null;
};

export default function VerifyEmailPrompt({
  email,
  onResend,
  onContinue,
  isResendDisabled,
  resendSecondsLeft,
  feedbackMessage,
  errorMessage,
}: VerifyEmailPromptProps) {
  const { t } = useLanguage();

  return (
    <div className="w-full max-w-md rounded-3xl border-4 border-[#BF7B45] bg-[#F7B27D] px-6 py-8 text-center shadow-[0_10px_25px_rgba(0,0,0,0.2)]">
      <h1 className="text-[#5D3A1A] font-black text-2xl">{t('verifyEmail.title')}</h1>
      <p className="mt-4 text-[#7B3F00] font-semibold text-sm leading-relaxed">
        {t('verifyEmail.subtitle')}
      </p>

      <div className="mt-4 rounded-xl bg-[#FAD3AE] border border-[#D4956A] px-4 py-3">
        <p className="text-[#7B3F00] text-xs font-bold uppercase tracking-wide">{t('verifyEmail.registeredEmail')}</p>
        <p className="text-[#5D3A1A] text-sm font-black break-all mt-1">{email || t('verifyEmail.noEmailFound')}</p>
      </div>

      {feedbackMessage && <p className="mt-4 text-green-800 text-sm font-semibold">{feedbackMessage}</p>}
      {errorMessage && <p className="mt-4 text-red-800 text-sm font-semibold">{errorMessage}</p>}

      <button
        type="button"
        onClick={onResend}
        disabled={isResendDisabled}
        className="mt-6 w-[220px] bg-[#2E8B2E] hover:bg-[#329932] text-white font-black uppercase tracking-wider text-sm py-3 rounded-full shadow-[0_6px_0_#1a5c1a] active:shadow-[0_2px_0_#1a5c1a] active:translate-y-1 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isResendDisabled && resendSecondsLeft > 0
          ? t('verifyEmail.resendIn').replace('{{seconds}}', String(resendSecondsLeft))
          : t('verifyEmail.resendEmail')}
      </button>

      <button
        type="button"
        onClick={onContinue}
        className="mt-4 block w-full text-[#7B3F00] underline font-semibold text-sm"
      >
        {t('verifyEmail.backToHome')}
      </button>
    </div>
  );
}
