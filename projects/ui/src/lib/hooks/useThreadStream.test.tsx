import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useThreadStream } from "./useThreadStream";

class FakeEventSource {
  static opened: string[] = [];
  static live: FakeEventSource[] = [];
  private listeners = new Map<string, (event: MessageEvent) => void>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeEventSource.opened.push(url);
    FakeEventSource.live.push(this);
  }
  addEventListener(name: string, handler: (event: MessageEvent) => void) {
    this.listeners.set(name, handler);
  }
  emit(name: string, data = "") {
    this.listeners.get(name)?.({ data } as MessageEvent);
  }
  fail() {
    this.onerror?.();
  }
  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_MOCKS", "false");
  FakeEventSource.opened = [];
  FakeEventSource.live = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useThreadStream", () => {
  it("signals on a message frame", () => {
    const onFrame = vi.fn();
    renderHook(() => useThreadStream("t1", { onFrame }));

    FakeEventSource.live[0].emit("text", "Finished the file");

    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it("signals on every kind the backend names, not just text", () => {
    const onFrame = vi.fn();
    renderHook(() => useThreadStream("t1", { onFrame }));

    for (const kind of ["text", "file_write", "question", "event"]) {
      FakeEventSource.live[0].emit(kind);
    }

    // Named frames are why the generic hook's `onmessage` would never fire.
    expect(onFrame).toHaveBeenCalledTimes(4);
  });

  it("reconnects with a backoff after the stream drops", async () => {
    renderHook(() => useThreadStream("t1", { onFrame: vi.fn() }));
    expect(FakeEventSource.opened).toHaveLength(1);

    FakeEventSource.live[0].fail();

    // Not immediate: a tight reconnect loop against a failing server is worse
    // than waiting.
    expect(FakeEventSource.opened).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeEventSource.opened).toHaveLength(2);
  });

  it("backs off further on a repeated failure", async () => {
    renderHook(() => useThreadStream("t1", { onFrame: vi.fn() }));

    FakeEventSource.live[0].fail();
    await vi.advanceTimersByTimeAsync(1000);
    FakeEventSource.live[1].fail();
    await vi.advanceTimersByTimeAsync(1000);

    expect(FakeEventSource.opened).toHaveLength(2); // 2s not yet elapsed
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeEventSource.opened).toHaveLength(3);
  });

  it("never subscribes to a resolved thread", () => {
    // The backend closes a resolved thread's stream deliberately. Reconnecting
    // to it with backoff forever is the bug this guard prevents.
    renderHook(() => useThreadStream("t1", { enabled: false, onFrame: vi.fn() }));

    expect(FakeEventSource.opened).toEqual([]);
  });

  it("closes the stream when the thread changes", () => {
    const { rerender } = renderHook(
      ({ id }) => useThreadStream(id, { onFrame: vi.fn() }),
      { initialProps: { id: "t1" } },
    );

    rerender({ id: "t2" });

    expect(FakeEventSource.live[0].closed).toBe(true);
    expect(FakeEventSource.opened).toEqual([
      "/api/threads/t1/stream",
      "/api/threads/t2/stream",
    ]);
  });

  it("stops reconnecting once unmounted", async () => {
    const { unmount } = renderHook(() => useThreadStream("t1", { onFrame: vi.fn() }));

    FakeEventSource.live[0].fail();
    unmount();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(FakeEventSource.opened).toHaveLength(1);
  });
});

describe("useThreadStream — mock mode", () => {
  it("does not subscribe when mocks are on, because MSW cannot intercept EventSource", () => {
    // Without this the request reaches the Vite proxy, ECONNREFUSEs, and the
    // backoff loop retries forever per open thread.
    vi.stubEnv("VITE_USE_MOCKS", "true");

    renderHook(() => useThreadStream("t1", { onFrame: vi.fn() }));

    expect(FakeEventSource.opened).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("does not subscribe when the flag is unset either, since that is also mocked", () => {
    vi.stubEnv("VITE_USE_MOCKS", undefined as unknown as string);

    renderHook(() => useThreadStream("t1", { onFrame: vi.fn() }));

    expect(FakeEventSource.opened).toEqual([]);
    vi.unstubAllEnvs();
  });
});
