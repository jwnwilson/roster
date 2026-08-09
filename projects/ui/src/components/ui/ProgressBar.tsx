export function ProgressBar(
  { value, tone = "accent", height = 3 }: { value: number; tone?: "accent" | "muted"; height?: number },
) {
  const pct = `${Math.max(0, Math.min(1, value)) * 100}%`;
  return (
    <div className="w-full rounded-[1px] bg-bg-track" style={{ height }}>
      <div data-fill className={`h-full rounded-[1px] ${tone === "accent" ? "bg-accent" : "bg-fill-secondary"}`} style={{ width: pct }} />
    </div>
  );
}
