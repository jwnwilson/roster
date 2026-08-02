export type BadgeKind = "action_needed" | "review_needed" | "info" | "resolved" | "working" | "idle";

const BADGES: Record<BadgeKind, { label: string; bg: string; border: string; color: string }> = {
  action_needed: { label: "ACTION NEEDED", bg: "var(--badge-action-bg)", border: "var(--badge-action-border)", color: "var(--badge-action-text)" },
  review_needed: { label: "REVIEW NEEDED", bg: "var(--badge-review-bg)", border: "var(--badge-review-border)", color: "var(--badge-review-text)" },
  info:          { label: "INFO",          bg: "var(--badge-info-bg)",  border: "var(--badge-info-border)",  color: "var(--badge-info-text)" },
  resolved:      { label: "RESOLVED",      bg: "var(--badge-resolved-bg)",  border: "var(--badge-resolved-border)",  color: "var(--badge-resolved-text)" },
  working:       { label: "WORKING",       bg: "rgba(124,108,240,0.12)", border: "rgba(124,108,240,0.25)", color: "var(--accent-text)" },
  idle:          { label: "IDLE",          bg: "transparent",            border: "rgba(255,255,255,0.05)", color: "var(--text-7)" },
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
