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
      className="relative inline-block rounded-[8px] transition-colors"
      style={{ width: 26, height: 15, background: checked ? "var(--accent)" : "var(--bg-toggle-off)" }}
    >
      <span
        className="absolute top-[2px] rounded-full transition-all"
        style={{ width: 11, height: 11, left: checked ? 13 : 2, background: checked ? "var(--knob-on)" : "var(--dot-muted)" }}
      />
    </button>
  );
}
