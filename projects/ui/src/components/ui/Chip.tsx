import type { ReactNode } from "react";

export function Chip(
  { children, active = false, onClick }: { children: ReactNode; active?: boolean; onClick?: () => void },
) {
  return (
    <button
      data-active={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1 h-[26px] px-[9px] rounded-[5px] border border-border-strong text-[11px] ${
        active ? "bg-[rgba(255,255,255,0.07)] text-text-2" : "text-text-4"
      }`}
    >
      {children}
    </button>
  );
}
