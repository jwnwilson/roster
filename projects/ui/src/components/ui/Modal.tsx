import { useEffect, useRef, type ReactNode } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

export function Modal({ title, onClose, footer, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panelRef.current?.contains(document.activeElement)) {
      panelRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-testid="modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="w-[440px] max-w-[92vw] rounded-[8px] border border-border bg-bg-surface text-text-1 shadow-xl outline-none"
      >
        <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] px-4 py-3">
          <span className="text-[13px] font-semibold">{title}</span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-text-4 hover:text-text-2 text-[15px] leading-none"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-[rgba(255,255,255,0.06)] px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
