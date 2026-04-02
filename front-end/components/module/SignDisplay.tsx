'use client';

import { useEffect, useState } from 'react';

interface SignDisplayProps {
  signName: string;
  duration?: number; // milliseconds to show, default 2000ms (2 seconds)
  onDismiss?: () => void;
}

/**
 * COMPONENT: SignDisplay
 * Shows a centered text overlay of the sign name for 1-2 seconds.
 * Fades in and out smoothly, with optional manual close button.
 * Used on first lesson view to help students understand what sign they're learning.
 */
export default function SignDisplay({
  signName,
  duration = 2000,
  onDismiss,
}: SignDisplayProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Auto-dismiss after duration
    const timer = setTimeout(() => {
      setIsVisible(false);
      onDismiss?.();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onDismiss]);

  if (!isVisible) return null;

  return (
    <>
      {/* Semi-transparent backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity duration-500"
        style={{
          opacity: isVisible ? 1 : 0,
          pointerEvents: isVisible ? 'auto' : 'none',
        }}
      />

      {/* Centered sign name overlay */}
      <div className="fixed inset-0 flex flex-col items-center justify-center z-50 pointer-events-none">
        <div
          className="text-center px-4 transition-all duration-500"
          style={{
            transform: isVisible ? 'scale(1)' : 'scale(0.8)',
            opacity: isVisible ? 1 : 0,
          }}
        >
          <p className="text-white text-5xl sm:text-6xl md:text-7xl font-black drop-shadow-2xl">
            {signName}
          </p>
          <p className="text-white/80 text-lg sm:text-xl mt-4 font-semibold drop-shadow-lg">
            Learn this sign
          </p>
        </div>

        {/* Close button (top-right) */}
        <button
          onClick={() => {
            setIsVisible(false);
            onDismiss?.();
          }}
          className="absolute top-6 right-6 pointer-events-auto w-10 h-10 flex items-center justify-center rounded-full bg-white/80 hover:bg-white transition-colors"
          aria-label="Dismiss sign display"
        >
          <svg
            viewBox="0 0 24 24"
            className="w-6 h-6 text-gray-800"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </>
  );
}
