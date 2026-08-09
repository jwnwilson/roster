import type { IconProps } from "./types";

export function CheckIcon({ size = 13, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none" {...props}>
      <path
        d="M4.5 6.5l1.5 1.5 2.5-2.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
