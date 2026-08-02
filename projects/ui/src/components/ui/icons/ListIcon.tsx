import type { IconProps } from "./types";

export function ListIcon({ size = 12, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" {...props}>
      <path
        d="M1.5 3.5h9M1.5 6h9M1.5 8.5h9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
