import type { IconProps } from "./types";

export function InboxIcon({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none" className={className}>
      <path
        d="M1.5 7.5h2.8l1 2h2.4l1-2H11.5V11a.5.5 0 01-.5.5h-9a.5.5 0 01-.5-.5V7.5z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M1.5 7.5L3 2h7l1.5 5.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
