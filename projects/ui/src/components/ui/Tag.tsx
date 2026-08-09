import type { ReactNode } from "react";

export function Tag({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "accent" }) {
  const styles =
    tone === "accent"
      ? "bg-accent-bg border-accent-border text-accent-text"
      : "border-border text-text-4";
  return (
    <span className={`inline-flex items-center rounded-[4px] border px-[7px] py-[2px] font-mono text-[9.5px] ${styles}`}>
      {children}
    </span>
  );
}
