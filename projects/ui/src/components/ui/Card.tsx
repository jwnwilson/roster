import type { ReactNode } from "react";
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-bg-surface border border-border rounded-[8px] ${className}`}>{children}</div>;
}
