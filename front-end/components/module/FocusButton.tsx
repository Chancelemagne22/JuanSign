'use client';

import { useState } from 'react';

interface FocusButtonProps {
  isFocused: boolean;
  onToggle: () => Promise<void>;
  disabled?: boolean;
}

/**
 * COMPONENT: FocusButton
 * Heart icon button to add/remove lesson from favorites.
 * Styled to match the green control buttons.
 * Filled heart = focused/favorited, outline heart = not focused.
 */
export default function FocusButton({
  isFocused,
  onToggle,
  disabled = false,
}: FocusButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  async function handleClick() {
    if (isLoading || disabled) return;
    setIsLoading(true);
    try {
      await onToggle();
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={disabled || isLoading}
      aria-label={isFocused ? 'Remove from focus list' : 'Add to focus list'}
      className="
        w-11 h-11 rounded-full
        bg-[#33AA11] border-[3px] border-[#228800]
        flex items-center justify-center
        shadow-[0_4px_0_#165c00]
        active:translate-y-1 active:shadow-[0_1px_0_#165c00]
        transition-transform hover:brightness-110
        disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-[0_4px_0_#165c00]
      "
      title={isFocused ? 'Added to focus list' : 'Add to focus list'}
    >
      <svg
        viewBox="0 0 24 24"
        className="w-5 h-5 text-white"
        fill={isFocused ? 'currentColor' : 'none'}
        stroke={isFocused ? 'currentColor' : 'currentColor'}
        strokeWidth={isFocused ? 0 : 2}
        aria-hidden
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  );
}
