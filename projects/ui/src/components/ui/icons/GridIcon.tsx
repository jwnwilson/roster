import type { IconProps } from "./types";

export function GridIcon({ size = 12, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" {...props}>
      <rect x="1" y="1" width="4" height="4" rx=".75" stroke="currentColor" strokeWidth="1.2" />
      <rect x="7" y="1" width="4" height="4" rx=".75" stroke="currentColor" strokeWidth="1.2" />
      <rect x="1" y="7" width="4" height="4" rx=".75" stroke="currentColor" strokeWidth="1.2" />
      <rect x="7" y="7" width="4" height="4" rx=".75" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
