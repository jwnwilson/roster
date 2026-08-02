import type { TextareaHTMLAttributes } from "react";

export function Textarea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`min-h-[72px] rounded-[5px] border border-border bg-bg-input px-2 py-1.5 text-[12px] text-text-1 outline-none focus:border-accent ${className}`}
      {...rest}
    />
  );
}
