import type { IconProps } from "./types";

export function PencilIcon({ size = 11, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 11 11" fill="none" className={className}>
      <path
        d="M7.4 1.6l2 2L4 9l-2.4.6L2.2 7.2 7.4 1.6z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M6.6 2.4l2 2" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
