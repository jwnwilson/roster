import { describe, expect, it, vi } from "vitest";

import { resolveShellPath } from "./shell-path";

describe("resolveShellPath", () => {
  it("prefers the login shell's PATH", async () => {
    // Arrange
    const readShellPath = vi.fn().mockResolvedValue("/opt/homebrew/bin:/usr/bin:/bin");

    // Act
    const resolved = await resolveShellPath({
      readShellPath,
      inheritedPath: "/usr/bin:/bin",
    });

    // Assert
    expect(resolved).toEqual({
      path: "/opt/homebrew/bin:/usr/bin:/bin",
      source: "login-shell",
    });
  });

  it("falls back to the inherited PATH when the shell fails", async () => {
    // A tester with an exotic shell rc that errors must still get an app.
    // Arrange
    const readShellPath = vi.fn().mockRejectedValue(new Error("timed out"));

    // Act
    const resolved = await resolveShellPath({
      readShellPath,
      inheritedPath: "/usr/bin:/bin",
    });

    // Assert
    expect(resolved).toEqual({ path: "/usr/bin:/bin", source: "inherited" });
  });

  it("falls back when the shell returns nothing usable", async () => {
    // Arrange
    const readShellPath = vi.fn().mockResolvedValue("   ");

    // Act
    const resolved = await resolveShellPath({
      readShellPath,
      inheritedPath: "/usr/bin:/bin",
    });

    // Assert
    expect(resolved.source).toBe("inherited");
  });

  it("trims the shell's trailing newline", async () => {
    // Arrange
    const readShellPath = vi.fn().mockResolvedValue("/usr/local/bin:/usr/bin\n");

    // Act
    const resolved = await resolveShellPath({
      readShellPath,
      inheritedPath: "/usr/bin",
    });

    // Assert
    expect(resolved.path).toBe("/usr/local/bin:/usr/bin");
  });
});
