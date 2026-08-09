export function PulseDot({ size = 6, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      className={`rounded-full bg-accent animate-[pulse_2s_infinite] ${className}`}
      style={{ width: size, height: size, boxShadow: "var(--accent-halo)" }}
    />
  );
}
