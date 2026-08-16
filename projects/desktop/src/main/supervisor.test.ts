import { describe, expect, it, vi } from "vitest";

import { SIGTERM_GRACE_MS, stopSidecar } from "./supervisor";

/** A sidecar that exits after `exitAfterMs` of simulated waiting. */
function sidecarExitingAfter(exitAfterMs: number | null) {
  let resolveExit: () => void;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  return {
    sidecar: { pid: 4242, exited },
    release: () => resolveExit(),
    exitAfterMs,
  };
}

describe("stopSidecar", () => {
  it("signals the whole process group, not just the visible pid", async () => {
    // uvicorn is a grandchild of the spawn. Killing the recorded pid leaves it
    // running and holding the port -- the lesson the Makefile records twice.
    // Arrange
    const { sidecar, release } = sidecarExitingAfter(0);
    const kill = vi.fn();
    release();

    // Act
    await stopSidecar(sidecar, { kill, sleep: async () => {} });

    // Assert
    expect(kill).toHaveBeenCalledWith(-4242, "SIGTERM");
  });

  it("does not SIGKILL a sidecar that exits within the grace period", async () => {
    // SIGKILL skips uvicorn's graceful shutdown, so the turn manager never
    // cancels and real agent CLIs are orphaned.
    // Arrange
    const { sidecar, release } = sidecarExitingAfter(0);
    const kill = vi.fn();
    release();

    // Act
    const outcome = await stopSidecar(sidecar, { kill, sleep: async () => {} });

    // Assert
    expect(outcome).toEqual({ kind: "graceful" });
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalledWith(-4242, "SIGKILL");
  });

  it("SIGKILLs a sidecar that ignores SIGTERM", async () => {
    // Arrange -- never released, so it never exits.
    const { sidecar } = sidecarExitingAfter(null);
    const kill = vi.fn();

    // Act
    const outcome = await stopSidecar(sidecar, { kill, sleep: async () => {} });

    // Assert
    expect(outcome).toEqual({ kind: "killed" });
    expect(kill).toHaveBeenNthCalledWith(1, -4242, "SIGTERM");
    expect(kill).toHaveBeenNthCalledWith(2, -4242, "SIGKILL");
  });

  it("waits the runtime's own grace period before killing", async () => {
    // 5s matches SubprocessRuntime._SIGTERM_GRACE_SECONDS. Shorter would cut off
    // agents mid-cleanup.
    // Arrange
    const { sidecar } = sidecarExitingAfter(null);
    const sleep = vi.fn().mockResolvedValue(undefined);

    // Act
    await stopSidecar(sidecar, { kill: vi.fn(), sleep });

    // Assert
    expect(sleep).toHaveBeenCalledWith(SIGTERM_GRACE_MS);
  });

  it("is safe to call when the sidecar has already gone", async () => {
    // Quitting twice, or quitting after a crash dialog, must not throw.
    // Arrange
    const { sidecar, release } = sidecarExitingAfter(0);
    const kill = vi.fn().mockImplementation(() => {
      throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    });
    release();

    // Act
    const outcome = await stopSidecar(sidecar, { kill, sleep: async () => {} });

    // Assert -- ESRCH is benign: the process is already gone, so this still
    // counts as a successful (graceful) stop, not a failure.
    expect(outcome).toEqual({ kind: "graceful" });
  });

  it("does not report a successful stop when the signal hits a permission error", async () => {
    // EPERM means the signal genuinely did not land -- the sidecar is still
    // alive. Swallowing this the way ESRCH is swallowed would tell the caller
    // the shutdown cascade ran when it never started.
    // Arrange
    const { sidecar } = sidecarExitingAfter(null);
    const permissionError = Object.assign(new Error("not permitted"), { code: "EPERM" });
    const kill = vi.fn().mockImplementation(() => {
      throw permissionError;
    });

    // Act
    const outcome = await stopSidecar(sidecar, { kill, sleep: async () => {} });

    // Assert
    expect(outcome).toEqual({ kind: "signal-failed", error: permissionError });
  });

  it("reports signal-failed when the final SIGKILL cannot be delivered", async () => {
    // The grace-period SIGTERM lands, the sidecar ignores it, and the
    // follow-up SIGKILL hits a permission error. The caller must learn the
    // process is still running, not believe it was killed.
    // Arrange
    const { sidecar } = sidecarExitingAfter(null);
    const permissionError = Object.assign(new Error("not permitted"), { code: "EPERM" });
    const kill = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw permissionError;
      });

    // Act
    const outcome = await stopSidecar(sidecar, { kill, sleep: async () => {} });

    // Assert
    expect(outcome).toEqual({ kind: "signal-failed", error: permissionError });
  });

  it.each([-1, 0])("never signals a non-positive pid (%i)", async (pid) => {
    // spawn.ts records pid: -1 when Node fails to obtain a child pid.
    // -pid would then be 1 (launchd) or 0 (the caller's own process group) --
    // both far worse than doing nothing.
    // Arrange
    const sidecar = { pid, exited: Promise.resolve() };
    const kill = vi.fn();

    // Act
    const outcome = await stopSidecar(sidecar, { kill, sleep: async () => {} });

    // Assert
    expect(kill).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: "no-pid" });
  });
});
