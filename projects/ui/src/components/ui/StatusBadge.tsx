export type BadgeKind = "action_needed" | "review_needed" | "info" | "resolved" | "working" | "active" | "disabled" | "idle";

const BADGES: Record<BadgeKind, { label: string; bg: string; border: string; color: string }> = {
  action_needed: { label: "ACTION NEEDED", bg: "var(--badge-action-bg)", border: "var(--badge-action-border)", color: "var(--badge-action-text)" },
  review_needed: { label: "REVIEW NEEDED", bg: "var(--badge-review-bg)", border: "var(--badge-review-border)", color: "var(--badge-review-text)" },
  info:          { label: "INFO",          bg: "var(--badge-info-bg)",  border: "var(--badge-info-border)",  color: "var(--badge-info-text)" },
  resolved:      { label: "RESOLVED",      bg: "var(--badge-resolved-bg)",  border: "var(--badge-resolved-border)",  color: "var(--badge-resolved-text)" },
  // The three agent states, and only three (spec §4, handoff §Screen C).
  working:       { label: "WORKING",       bg: "var(--agent-working-bg)",  border: "var(--agent-working-border)",  color: "var(--agent-working)" },
  active:        { label: "ACTIVE",        bg: "var(--agent-active-bg)",  border: "var(--agent-active-border)",  color: "var(--agent-active)" },
  disabled:      { label: "DISABLED",      bg: "var(--agent-disabled-bg)",    border: "var(--agent-disabled-border)",    color: "var(--agent-disabled)" },
  idle:          { label: "IDLE",          bg: "transparent",            border: "var(--overlay-05)", color: "var(--text-7)" },
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
