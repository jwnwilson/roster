import type { PointerEvent as ReactPointerEvent } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { clampWidth, useResizableWidth } from "./useResizableWidth";

// A right-docked panel is resized by dragging its left edge: moving the pointer
// left (smaller clientX) must widen it.
const pointerDown = (clientX: number) =>
  ({ clientX, preventDefault: () => {} }) as unknown as ReactPointerEvent;

describe("clampWidth", () => {
  it("clamps below the minimum, above the maximum, and passes values through", () => {
    expect(clampWidth(100, 240, 640)).toBe(240);
    expect(clampWidth(900, 240, 640)).toBe(640);
    expect(clampWidth(400, 240, 640)).toBe(400);
  });
});

describe("useResizableWidth", () => {
  beforeEach(() => localStorage.clear());

  it("starts at the persisted width, falling back to the initial", () => {
    const { result } = renderHook(() => useResizableWidth("w", 292, 240, 640));
    expect(result.current.width).toBe(292);
    expect(result.current.isResizing).toBe(false);
  });

  it("widens the panel as the handle is dragged left and persists on release", () => {
    const { result } = renderHook(() => useResizableWidth("w", 292, 240, 640));

    act(() => result.current.onResizeStart(pointerDown(500)));
    act(() => window.dispatchEvent(new MouseEvent("pointermove", { clientX: 420 })));

    expect(result.current.width).toBe(372); // 292 + (500 - 420)
    expect(result.current.isResizing).toBe(true);

    act(() => window.dispatchEvent(new MouseEvent("pointerup", { clientX: 420 })));

    expect(result.current.isResizing).toBe(false);
    expect(JSON.parse(localStorage.getItem("w")!)).toBe(372);
  });

  it("clamps the live width to the maximum while dragging", () => {
    const { result } = renderHook(() => useResizableWidth("w", 292, 240, 640));

    act(() => result.current.onResizeStart(pointerDown(500)));
    act(() => window.dispatchEvent(new MouseEvent("pointermove", { clientX: -1000 })));

    expect(result.current.width).toBe(640);
  });
});
