import { describe, expect, it, vi } from "vitest";

import { HealthTimeout, waitForHealth } from "./health";

/** A clock that advances only when the code under test sleeps. */
function fakeClock() {
  let current = 0;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
  };
}

describe("waitForHealth", () => {
  it("resolves as soon as the server answers 200", async () => {
    // Arrange
    const clock = fakeClock();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);

    // Act
    await waitForHealth({ url: "http://127.0.0.1:1/api/health", fetchImpl, ...clock });

    // Assert
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps polling while the server is still starting", async () => {
    // Arrange
    const clock = fakeClock();
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue({ ok: true } as Response);

    // Act
    await waitForHealth({ url: "http://127.0.0.1:1/api/health", fetchImpl, ...clock });

    // Assert
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("treats a non-200 answer as not ready yet", async () => {
    // A 503 from a half-started server is not a reason to give up.
    // Arrange
    const clock = fakeClock();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValue({ ok: true } as Response);

    // Act
    await waitForHealth({ url: "http://127.0.0.1:1/api/health", fetchImpl, ...clock });

    // Assert
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up with HealthTimeout once the budget is spent", async () => {
    // Arrange
    const clock = fakeClock();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    // Act / Assert
    await expect(
      waitForHealth({
        url: "http://127.0.0.1:1/api/health",
        fetchImpl,
        ...clock,
        timeoutMs: 1000,
        intervalMs: 250,
      }),
    ).rejects.toBeInstanceOf(HealthTimeout);
  });
});
