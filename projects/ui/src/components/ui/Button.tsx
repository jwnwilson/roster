import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "tertiary" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white",
  secondary: "border border-[rgba(255,255,255,0.12)] text-text-3",
  tertiary: "border border-border text-text-4",
  danger: "bg-[#e5686b] text-white",
};

export function Button(
  { variant = "primary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant },
) {
  return (
    <button
      className={`inline-flex items-center gap-1 rounded-[5px] px-3 h-7 text-[11.5px] font-medium disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}
