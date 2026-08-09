export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** What this switch controls. Required: a switch with no accessible name is
   *  unusable with a screen reader, and there is nothing visible inside it to
   *  infer one from. */
  label: string;
}

export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      type="button"
      onClick={() => onChange(!checked)}
      className="relative inline-block rounded-[10px] transition-colors"
      style={{ width: 26, height: 14, background: checked ? "var(--accent)" : "var(--bg-badge)" }}
    >
      <span
        className="absolute top-[2px] rounded-full transition-all"
        style={{ width: 10, height: 10, left: checked ? 14 : 2, background: checked ? "var(--knob-on)" : "var(--dot-muted)" }}
      />
    </button>
  );
}
