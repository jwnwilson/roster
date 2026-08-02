import type { IconProps } from "./types";

/** Plain folder — a project whose source is not git (spec §6, a deliberate
 *  deviation from the handoff's repo-only assumption). */
export function FolderIcon({ size = 11, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 11 11" fill="none" {...props}>
      <path
        d="M1.2 2.9a.9.9 0 0 1 .9-.9h2.1l1 1.2h3.7a.9.9 0 0 1 .9.9v3.9a.9.9 0 0 1-.9.9H2.1a.9.9 0 0 1-.9-.9V2.9Z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
