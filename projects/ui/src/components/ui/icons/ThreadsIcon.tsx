import type { IconProps } from "./types";

/** Chat bubble — the Threads destination (handoff §Nav items list). */
export function ThreadsIcon({ size = 13, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none" {...props}>
      <path
        d="M1.5 3.2a1.2 1.2 0 0 1 1.2-1.2h7.6a1.2 1.2 0 0 1 1.2 1.2v4.6a1.2 1.2 0 0 1-1.2 1.2H5.2L2.6 11.2V9H2.7a1.2 1.2 0 0 1-1.2-1.2V3.2Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
