export type BadgeKind = "action_needed" | "review_needed" | "info" | "resolved" | "running" | "idle";

const BADGES: Record<BadgeKind, { label: string; bg: string; border: string; color: string }> = {
  action_needed: { label: "ACTION NEEDED", bg: "rgba(190,65,50,0.12)", border: "rgba(190,65,50,0.20)", color: "#b05848" },
  review_needed: { label: "REVIEW NEEDED", bg: "rgba(170,130,30,0.10)", border: "rgba(170,130,30,0.18)", color: "#907030" },
  info:          { label: "INFO",          bg: "rgba(50,80,160,0.10)",  border: "rgba(50,80,160,0.18)",  color: "#4868a0" },
  resolved:      { label: "RESOLVED",      bg: "rgba(50,110,60,0.08)",  border: "rgba(50,110,60,0.14)",  color: "#3d6a48" },
  running:       { label: "RUNNING",       bg: "rgba(124,108,240,0.12)", border: "rgba(124,108,240,0.25)", color: "#bab7f6" },
  idle:          { label: "IDLE",          bg: "transparent",            border: "rgba(255,255,255,0.05)", color: "#22252c" },
};

export function StatusBadge({ kind }: { kind: BadgeKind }) {
  const b = BADGES[kind];
  return (
    <span
      className="inline-flex items-center rounded-[3px] border font-mono font-semibold tracking-[0.03em] text-[8.5px] px-[5px] py-[2px]"
      style={{ background: b.bg, borderColor: b.border, color: b.color }}
    >
      {b.label}
    </span>
  );
}
