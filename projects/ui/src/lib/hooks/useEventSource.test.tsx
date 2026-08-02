import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reconnectDelay, ssePath, useEventSource } from "./useEventSource";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

describe("ssePath", () => {
  it("returns the path without the query string", () => {
    expect(ssePath("/api/threads/w1/activity/stream?after=5")).toBe(
      "/api/threads/w1/activity/stream",
    );
  });
  it("passes null through", () => {
    expect(ssePath(null)).toBeNull();
  });
});

describe("reconnectDelay", () => {
  it("grows exponentially and caps", () => {
    expect(reconnectDelay(0, 1000, 15000)).toBe(1000);
    expect(reconnectDelay(1, 1000, 15000)).toBe(2000);
    expect(reconnectDelay(2, 1000, 15000)).toBe(4000);
    expect(reconnectDelay(10, 1000, 15000)).toBe(15000);
  });
});

describe("useEventSource", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("parses and forwards message frames", () => {
    const received: unknown[] = [];
    renderHook(() => useEventSource<{ seq: number }>("/api/x/stream?after=0", (d) => received.push(d)));
    act(() => {
      FakeEventSource.instances[0].onmessage?.({ data: JSON.stringify({ seq: 7 }) });
    });
    expect(received).toEqual([{ seq: 7 }]);
  });

  it("does NOT reconnect when only the query cursor changes", () => {
    const { rerender } = renderHook(({ url }) => useEventSource(url, () => {}), {
      initialProps: { url: "/api/x/stream?after=0" },
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    rerender({ url: "/api/x/stream?after=5" });
    rerender({ url: "/api/x/stream?after=42" });
    expect(FakeEventSource.instances).toHaveLength(1); // same path → same live connection
  });

  it("reconnects after an error, resuming from the latest cursor", () => {
    const { rerender } = renderHook(({ url }) => useEventSource(url, () => {}), {
      initialProps: { url: "/api/x/stream?after=0" },
    });
    rerender({ url: "/api/x/stream?after=9" }); // cursor advanced (no reconnect yet)
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => {
      FakeEventSource.instances[0].onerror?.();
    });
    act(() => {
      vi.advanceTimersByTime(reconnectDelay(0));
    });
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1].url).toBe("/api/x/stream?after=9");
  });

  it("stops reconnecting once unmounted", () => {
    const { unmount } = renderHook(() => useEventSource("/api/x/stream?after=0", () => {}));
    act(() => {
      FakeEventSource.instances[0].onerror?.();
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});
