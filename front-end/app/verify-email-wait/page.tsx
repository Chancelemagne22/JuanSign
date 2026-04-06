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
  const [messageKey, setMessageKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
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
    setMessageKey(null);
    setErrorKey(null);

    if (resendSecondsLeft > 0) return;

    if (!email) {
      setErrorKey('verifyEmail.missingEmail');
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
      setErrorKey('verifyEmail.resendFailed');
      return;
    }

    setMessageKey(isAuto ? 'verifyEmail.sent' : 'verifyEmail.sent');
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
        feedbackMessage={messageKey ? t(messageKey) : null}
        errorMessage={errorKey ? t(errorKey) : null}
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
