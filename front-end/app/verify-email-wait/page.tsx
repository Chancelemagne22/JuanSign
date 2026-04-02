'use client';

import { Suspense } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import VerifyEmailPrompt from '@/components/auth/VerifyEmailPrompt';
import { useLanguage } from '@/hooks/useLanguage';

function VerifyEmailWaitContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const [isResending, setIsResending] = useState(false);
  const [resendSecondsLeft, setResendSecondsLeft] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoResendTriggered, setAutoResendTriggered] = useState(false);

  const email = useMemo(() => searchParams.get('email') ?? '', [searchParams]);

  useEffect(() => {
    if (resendSecondsLeft <= 0) return;

    const timeoutId = window.setTimeout(() => {
      setResendSecondsLeft((prev) => prev - 1);
    }, 1000);

    return () => window.clearTimeout(timeoutId);
  }, [resendSecondsLeft]);

  async function handleResend(isAuto = false) {
    setMessage(null);
    setError(null);

    if (resendSecondsLeft > 0) return;

    if (!email) {
      setError(t('verifyEmail.missingEmail'));
      return;
    }

    setIsResending(true);
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=/`,
      },
    });
    setIsResending(false);

    if (resendError) {
      setError(resendError.message || t('verifyEmail.resendFailed'));
      return;
    }

    setMessage(isAuto ? t('verifyEmail.sent') : t('verifyEmail.sent'));
    setResendSecondsLeft(10);
  }

  useEffect(() => {
    if (!email || autoResendTriggered) return;
    setAutoResendTriggered(true);
    void handleResend(true);
  }, [email, autoResendTriggered]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-5">
      <VerifyEmailPrompt
        email={email}
        onResend={handleResend}
        onContinue={() => router.push('/')}
        isResendDisabled={isResending || resendSecondsLeft > 0}
        resendSecondsLeft={resendSecondsLeft}
        feedbackMessage={message}
        errorMessage={error}
      />
    </div>
  );
}

export default function VerifyEmailWaitPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailWaitContent />
    </Suspense>
  );
}
