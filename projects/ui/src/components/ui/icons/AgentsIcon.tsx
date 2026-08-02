import type { IconProps } from "./types";

export function AgentsIcon({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none" className={className}>
      <rect x="4" y="4" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M5.5 4V2.5M7.5 4V2.5M5.5 10.5V9M7.5 10.5V9M4 5.5H2.5M4 7.5H2.5M9 5.5h1.5M9 7.5h1.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}
