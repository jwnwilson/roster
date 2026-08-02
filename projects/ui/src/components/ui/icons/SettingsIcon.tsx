import type { IconProps } from "./types";

export function SettingsIcon({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none" className={className}>
      <circle cx="6.5" cy="6.5" r="1.8" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M6.5 1.5v1.2M6.5 10.3v1.2M1.5 6.5h1.2M10.3 6.5h1.2M3.1 3.1l.85.85M9.05 9.05l.85.85M3.1 9.9l.85-.85M9.05 4l.85-.85"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}
