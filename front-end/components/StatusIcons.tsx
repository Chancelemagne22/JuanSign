// Shared status icons (inline SVG, currentColor-inheriting).
//
// Used for chapter badges and empty states across Practice / Assessment so the
// UI doesn't depend on emoji rendering, which varies by platform.

interface IconProps {
  className?: string;
}

// Chip / spark mark for "AI model coming soon" badges.
export function AIModelIcon({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M9 2v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2V8h-2V6c0-1.1-.9-2-2-2h-2V2h-2v2h-2V2H9zm0 4h6v6H9V6z" />
    </svg>
  );
}

// Warning-triangle mark for "under development / no content yet" states.
// The exclamation is knocked out (evenodd) so the badge background shows through.
export function UnderDevelopmentIcon({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M12 2 1 21h22L12 2zm-1.2 7h2.4v5.6h-2.4V9zm0 7.2h2.4v2.4h-2.4v-2.4z"
      />
    </svg>
  );
}
