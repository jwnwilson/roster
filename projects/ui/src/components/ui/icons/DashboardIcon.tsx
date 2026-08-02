import type { IconProps } from "./types";

export function DashboardIcon({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="currentColor" className={className}>
      <rect x="1" y="1" width="4.5" height="4.5" rx="1" />
      <rect x="7.5" y="1" width="4.5" height="4.5" rx="1" />
      <rect x="1" y="7.5" width="4.5" height="4.5" rx="1" />
      <rect x="7.5" y="7.5" width="4.5" height="4.5" rx="1" />
    </svg>
  );
}
