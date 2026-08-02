import type { SelectHTMLAttributes } from "react";

export function Select({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`h-8 rounded-[5px] border border-border bg-bg-input px-2 text-[12px] text-text-1 outline-none focus:border-accent ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}
