import { Suspense } from 'react';
import ResetPasswordPage from '@/components/login/ResetPasswordPage';

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#2E7D1C] to-[#1a4d10] flex items-center justify-center px-4 py-8">
      <div className="w-full modal-responsive">
        <div className="rounded-3xl border-[5px] border-[#C47A3A] bg-[#F5C47A] shadow-2xl px-responsive-md py-responsive-md">
          <div className="text-center py-8">
            <p className="text-[#7B3F00] font-semibold">Loading...</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordRoute() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <ResetPasswordPage />
    </Suspense>
  );
}
