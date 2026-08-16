import { describe, expect, it } from "vitest";

import { resolvePaths } from "./paths";

describe("resolvePaths", () => {
  it("points at the bundle's Resources when packaged", () => {
    // Act
    const paths = resolvePaths({
      isPackaged: true,
      resourcesPath: "/Applications/Roster.app/Contents/Resources",
      repoRoot: "/unused",
      homeDir: "/Users/tester",
    });

    // Assert
    expect(paths.pythonBin).toBe(
      "/Applications/Roster.app/Contents/Resources/python/bin/python",
    );
    expect(paths.uiDir).toBe("/Applications/Roster.app/Contents/Resources/ui");
    expect(paths.alembicIni).toBe(
      "/Applications/Roster.app/Contents/Resources/server/alembic.ini",
    );
  });

  it("points at the repo when running unpackaged", () => {
    // `pnpm start` during development runs against the checkout, not a bundle.
    // Act
    const paths = resolvePaths({
      isPackaged: false,
      resourcesPath: "/unused",
      repoRoot: "/repo",
      homeDir: "/Users/tester",
    });

    // Assert
    expect(paths.pythonBin).toBe("/repo/projects/desktop/build/python/bin/python");
    expect(paths.uiDir).toBe("/repo/projects/ui/dist");
    expect(paths.alembicIni).toBe("/repo/projects/server/alembic.ini");
  });

  it("puts the log where a tester can find it", () => {
    // Act
    const paths = resolvePaths({
      isPackaged: true,
      resourcesPath: "/Applications/Roster.app/Contents/Resources",
      repoRoot: "/unused",
      homeDir: "/Users/tester",
    });

    // Assert
    expect(paths.logFile).toBe("/Users/tester/Library/Logs/Roster/server.log");
  });
});
