import { describe, expect, it } from "vitest";

import { classifyMigration, STALE_BUNDLE_MESSAGE } from "./migrate";

describe("classifyMigration", () => {
  it("accepts a clean exit", () => {
    // Act
    const outcome = classifyMigration(0, "");

    // Assert
    expect(outcome).toEqual({ ok: true });
  });

  it("recognises a database newer than the bundle", () => {
    // This is the guard for the shared ~/.roster decision: an older .dmg opened
    // after dev moved the schema forward must refuse, not migrate.
    // Arrange
    const stderr =
      "alembic.util.exc.CommandError: Can't locate revision identified by 'a1b2c3d4e5f6'";

    // Act
    const outcome = classifyMigration(1, stderr);

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "stale-bundle", message: STALE_BUNDLE_MESSAGE });
  });

  it("reports any other failure with its stderr", () => {
    // Arrange
    const stderr = "sqlalchemy.exc.OperationalError: database is locked";

    // Act
    const outcome = classifyMigration(1, stderr);

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: "failed",
      message: "sqlalchemy.exc.OperationalError: database is locked",
    });
  });

  it("treats a signal death as a failure rather than a success", () => {
    // A null exit code means the process was killed. Nothing migrated.
    // Act
    const outcome = classifyMigration(null, "");

    // Assert
    expect(outcome.ok).toBe(false);
  });
});
