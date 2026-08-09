import type { IconProps } from "./types";

/** Stacked rack — the MCP Servers destination (handoff §Nav items list). */
export function McpIcon({ size = 13, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none" {...props}>
      <rect x="1.6" y="1.8" width="9.8" height="3.1" rx="0.9" stroke="currentColor" strokeWidth="1.1" />
      <rect x="1.6" y="8.1" width="9.8" height="3.1" rx="0.9" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="3.6" cy="3.35" r="0.6" fill="currentColor" />
      <circle cx="3.6" cy="9.65" r="0.6" fill="currentColor" />
    </svg>
  );
}
