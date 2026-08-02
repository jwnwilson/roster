import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useState } from "react";
import { useLocalStorage } from "./useLocalStorage";

/** Constrain `value` to the inclusive `[min, max]` range. */
export function clampWidth(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface ResizableWidth {
  /** Current width in px — the live drag value while resizing, else persisted. */
  width: number;
  /** True while the user is actively dragging the handle. */
  isResizing: boolean;
  /** Pointer-down handler to attach to the drag handle on the panel's edge. */
  onResizeStart: (event: ReactPointerEvent) => void;
}

/**
 * Track a persisted, drag-resizable width for a right-docked panel.
 *
 * The handle sits on the panel's left edge, so dragging the pointer left
 * (a smaller `clientX`) widens it. The width is committed to localStorage only
 * on pointer release to avoid a write per pointer-move.
 */
export function useResizableWidth(
  key: string,
  initial: number,
  min: number,
  max: number,
): ResizableWidth {
  const [persisted, setPersisted] = useLocalStorage<number>(key, initial);
  const [live, setLive] = useState<number | null>(null);

  const onResizeStart = useCallback(
    (event: ReactPointerEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = clampWidth(persisted, min, max);
      const widthAt = (clientX: number) => clampWidth(startWidth + (startX - clientX), min, max);

      setLive(startWidth);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const handleMove = (e: PointerEvent) => setLive(widthAt(e.clientX));
      const handleUp = (e: PointerEvent) => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        setPersisted(widthAt(e.clientX));
        setLive(null);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [persisted, setPersisted, min, max],
  );

  return { width: live ?? clampWidth(persisted, min, max), isResizing: live !== null, onResizeStart };
}
