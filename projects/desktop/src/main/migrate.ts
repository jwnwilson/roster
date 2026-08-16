export const STALE_BUNDLE_MESSAGE = "This copy of Roster is older than your data.";

/** Alembic's own wording when the database names a revision this build lacks. */
const UNKNOWN_REVISION = "Can't locate revision identified by";

export type MigrationOutcome =
  | { ok: true }
  | { ok: false; reason: "stale-bundle" | "failed"; message: string };

/**
 * Turn `alembic upgrade head`'s exit into something the shell can act on.
 *
 * Split from the spawning so the interesting half — telling "your app is old"
 * apart from "something broke" — is testable without running Alembic.
 */
export function classifyMigration(code: number | null, stderr: string): MigrationOutcome {
  if (code === 0) return { ok: true };
  if (stderr.includes(UNKNOWN_REVISION)) {
    return { ok: false, reason: "stale-bundle", message: STALE_BUNDLE_MESSAGE };
  }
  return {
    ok: false,
    reason: "failed",
    message: stderr.trim() || `alembic exited with ${code === null ? "a signal" : code}`,
  };
}
