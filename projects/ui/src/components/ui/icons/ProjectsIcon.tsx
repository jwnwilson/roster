import type { IconProps } from "./types";

export function ProjectsIcon({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none" className={className}>
      <path
        d="M1.5 5A1.5 1.5 0 013 3.5h2.4l1.5 1.5H10A1.5 1.5 0 0111.5 6.5V10A1.5 1.5 0 0110 11.5H3A1.5 1.5 0 011.5 10V5z"
        stroke="currentColor"
        strokeWidth="1.1"
      />
    </svg>
  );
}
