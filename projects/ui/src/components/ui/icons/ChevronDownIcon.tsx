import type { IconProps } from "./types";

export function ChevronDownIcon({ size = 10, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" {...props}>
      <path d="M2.5 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
