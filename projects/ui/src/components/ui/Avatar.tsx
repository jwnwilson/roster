type AvatarVariant = "user" | "agent" | "subagent";

const SHAPE: Record<AvatarVariant, string> = {
  // Violet orchestrator avatar (lead agent).
  agent: "rounded-[5px] bg-accent",
  // Muted subagent avatar — dark fill so the lead stays visually distinct (D3).
  subagent:
    "rounded-[5px] bg-[#1e2028] border border-[rgba(255,255,255,0.09)] text-[#7a7d86]",
  // Circular user avatar.
  user: "rounded-full bg-[#1c1e26] border-[1.5px] border-[rgba(255,255,255,0.13)] text-text-3",
};

export function Avatar({
  initials, variant = "user", size = 24,
}: { initials: string; variant?: AvatarVariant; size?: number }) {
  const base = "inline-flex items-center justify-center font-mono font-bold text-white";
  return (
    <span
      className={`${base} ${SHAPE[variant]}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials}
    </span>
  );
}
