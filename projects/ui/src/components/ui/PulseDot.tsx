export function PulseDot({ size = 6, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      className={`rounded-full bg-accent animate-[pulse_2s_infinite] ${className}`}
      style={{ width: size, height: size, boxShadow: "0 0 0 2.5px rgba(124,108,240,0.20)" }}
    />
  );
}
