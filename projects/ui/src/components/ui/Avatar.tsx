import type { HTMLAttributes } from "react";

/** No "subagent" variant: the design removed subagents entirely, and roster's
 *  model has no such concept (spec §4). */
type AvatarVariant = "user" | "agent";

const SHAPE: Record<AvatarVariant, string> = {
  // Violet agent avatar.
  agent: "rounded-[5px] bg-accent",
  // Circular user avatar.
  user: "rounded-full bg-bg-avatar border-[1.5px] border-[rgba(255,255,255,0.13)] text-text-3",
};

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  initials: string;
  variant?: AvatarVariant;
  size?: number;
}

export function Avatar({ initials, variant = "user", size = 24, ...props }: AvatarProps) {
  const base = "inline-flex items-center justify-center font-mono font-bold text-white";
  return (
    <span
      {...props}
      className={`${base} ${SHAPE[variant]} ${props.className ?? ""}`}
      style={{ width: size, height: size, fontSize: size * 0.4, ...props.style }}
    >
      {initials}
    </span>
  );
}
