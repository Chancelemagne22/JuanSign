import { Suspense } from 'react';
import ResetPasswordPage from '@/components/login/ResetPasswordPage';

export default function ResetPasswordRoute() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordPage />
    </Suspense>
  );
}
