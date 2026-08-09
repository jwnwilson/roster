import type { InputHTMLAttributes } from "react";

export function TextInput({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-8 rounded-[5px] border border-border bg-bg-input px-2 text-[12px] text-text-1 outline-none focus:border-accent ${className}`}
      {...rest}
    />
  );
}
