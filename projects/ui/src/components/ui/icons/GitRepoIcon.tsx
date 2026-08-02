import type { IconProps } from "./types";

export function GitRepoIcon({ size = 11, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 11 11" fill="none" className={className}>
      <rect x=".75" y=".75" width="9.5" height="9.5" rx="1.5" stroke="currentColor" strokeWidth="1" />
      <path d="M.75 3.75h9.5" stroke="currentColor" strokeWidth="1" />
      <circle cx="2.5" cy="2.25" r=".6" fill="currentColor" />
      <circle cx="4" cy="2.25" r=".6" fill="currentColor" />
    </svg>
  );
}
