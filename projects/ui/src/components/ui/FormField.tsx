import type { ReactNode } from "react";

export function FormField(
  { label, error, htmlFor, children }: { label: string; error?: string; htmlFor?: string; children: ReactNode },
) {
  return (
    <label htmlFor={htmlFor} className="mb-3 flex flex-col gap-1">
      <span className="text-[11px] font-medium text-text-3">{label}</span>
      {children}
      {error && <span className="text-[10.5px] text-[#e5686b]">{error}</span>}
    </label>
  );
}
