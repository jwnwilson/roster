import type { IconProps } from "./types";

export function DocumentIcon({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 14" fill="none" className={className}>
      <rect x=".75" y=".75" width="10.5" height="12.5" rx="1.5" stroke="currentColor" strokeWidth="1" />
      <path d="M3 5h6M3 7.5h6M3 10h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}
