import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import { STALE_BUNDLE_MESSAGE } from "./migrate";
import { runMigration, sidecarEnv, spawnSidecar } from "./spawn";

describe("sidecarEnv", () => {
  it("hands the sidecar the resolved PATH", () => {
    // Act
    const env = sidecarEnv({
      basePath: "/opt/homebrew/bin:/usr/bin",
      uiDir: "/Resources/ui",
      inherited: { HOME: "/Users/tester" },
    });

    // Assert
    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
  });

  it("turns real agents on", () => {
    // Act
    const env = sidecarEnv({ basePath: "/usr/bin", uiDir: "/ui", inherited: {} });

    // Assert
    expect(env.roster_use_subprocess_runtime).toBe("true");
  });

  it("points the server at the bundled UI", () => {
    // Act
    const env = sidecarEnv({ basePath: "/usr/bin", uiDir: "/Resources/ui", inherited: {} });

    // Assert
    expect(env.roster_ui_dir).toBe("/Resources/ui");
  });

  it("leaves the data root unset so ~/.roster wins", () => {
    // Spec §1.1: one machine, one person, one roster. Setting it here would
    // silently fork the operator's data.
    // Act
    const env = sidecarEnv({
      basePath: "/usr/bin",
      uiDir: "/ui",
      inherited: { roster_data_root: "/somewhere/stale" },
    });

    // Assert
    expect(env.roster_data_root).toBeUndefined();
  });
});

/** Collects everything written, so the log plumbing can be asserted on. */
function captureStream() {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  return { stream, text: () => Buffer.concat(chunks).toString() };
}

describe("spawnSidecar", () => {
  it("reports a pid and resolves when the process exits", async () => {
    // /bin/sh stands in for the bundled interpreter: this is about the plumbing,
    // not about Python.
    // Arrange
    const log = captureStream();

    // Act
    const sidecar = spawnSidecar({
      pythonBin: "/bin/sh",
      args: ["-c", "echo hello from the sidecar"],
      cwd: process.cwd(),
      env: process.env,
      logStream: log.stream,
    });
    await sidecar.exited;

    // Assert
    expect(sidecar.pid).toBeGreaterThan(0);
  });

  it("tees the child's output into the log", async () => {
    // A tester's only diagnostic is this file. If stdout is not captured, a
    // failed boot arrives as an empty log.
    // Arrange
    const log = captureStream();

    // Act
    const sidecar = spawnSidecar({
      pythonBin: "/bin/sh",
      args: ["-c", "echo on-stdout; echo on-stderr >&2"],
      cwd: process.cwd(),
      env: process.env,
      logStream: log.stream,
    });
    await sidecar.exited;

    // Assert
    expect(log.text()).toContain("on-stdout");
    expect(log.text()).toContain("on-stderr");
  });
});

describe("runMigration", () => {
  it("reports a clean migration", async () => {
    // Arrange
    const log = captureStream();

    // Act
    const outcome = await runMigration({
      pythonBin: "/bin/sh",
      args: ["-c", "exit 0"],
      cwd: process.cwd(),
      env: process.env,
      logStream: log.stream,
    });

    // Assert
    expect(outcome).toEqual({ ok: true });
  });

  it("recognises a database newer than the bundle from real stderr", async () => {
    // The end-to-end version of Task 8's classifier test: stderr really has to
    // reach classifyMigration for the stale-bundle guard to fire.
    // Arrange
    const log = captureStream();

    // Act
    const outcome = await runMigration({
      pythonBin: "/bin/sh",
      args: ["-c", "echo \"CommandError: Can't locate revision identified by 'abc'\" >&2; exit 1"],
      cwd: process.cwd(),
      env: process.env,
      logStream: log.stream,
    });

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: "stale-bundle",
      message: STALE_BUNDLE_MESSAGE,
    });
  });
});
