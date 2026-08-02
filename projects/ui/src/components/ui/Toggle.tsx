export function Toggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative inline-block rounded-[10px] transition-colors"
      style={{ width: 26, height: 14, background: checked ? "var(--accent)" : "#181a22" }}
    >
      <span
        className="absolute top-[2px] rounded-full transition-all"
        style={{ width: 10, height: 10, left: checked ? 14 : 2, background: checked ? "#fff" : "#3a3d44" }}
      />
    </button>
  );
}
