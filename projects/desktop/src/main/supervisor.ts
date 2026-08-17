/** Matches SubprocessRuntime._SIGTERM_GRACE_SECONDS on the Python side. */
export const SIGTERM_GRACE_MS = 5000;

export interface Sidecar {
  pid: number;
  exited: Promise<void>;
}

export interface StopDeps {
  kill: (pid: number, signal: NodeJS.Signals) => void;
  sleep: (ms: number) => Promise<void>;
}

/**
 * What `stopSidecar` found when it tried to stop the server.
 *
 * A union rather than a boolean because the caller's log line is the only
 * diagnostic a tester can send back, and "I could not signal it" has to be
 * distinguishable from "it stopped".
 */
export type StopOutcome =
  | { kind: "graceful" }
  | { kind: "killed" }
  | { kind: "signal-failed"; error: NodeJS.ErrnoException }
  | { kind: "no-pid" };

type SignalResult = { ok: true } | { ok: false; error: NodeJS.ErrnoException };

function signalGroup(deps: StopDeps, pid: number, signal: NodeJS.Signals): SignalResult {
  try {
    // Negative pid signals the process group. uvicorn is a grandchild of the
    // spawn, so signalling only the recorded pid leaves it running.
    deps.kill(-pid, signal);
    return { ok: true };
  } catch (error: unknown) {
    const failure = error as NodeJS.ErrnoException;
    // ESRCH alone is benign: the process is already gone, and stopping
    // something that stopped is not a failure. Every other code means the
    // signal did not land -- EPERM most of all, which says the process is
    // still running and we were not allowed to touch it. Swallowing that
    // would report a clean shutdown while agent CLIs keep running.
    if (failure.code === "ESRCH") return { ok: true };
    return { ok: false, error: failure };
  }
}

/**
 * Stop the sidecar, giving uvicorn time to shut down gracefully.
 *
 * The grace period is not politeness. Agent CLIs run in their own process
 * groups (start_new_session=True), so this signal never reaches them: only a
 * clean uvicorn shutdown lets the turn manager cancel its tasks, which is what
 * terminates the agents. SIGKILL first leaves them running after roster quits.
 */
export async function stopSidecar(sidecar: Sidecar, deps: StopDeps): Promise<StopOutcome> {
  // spawn.ts records `pid: child.pid ?? -1` when Node never handed back a pid.
  // Negating that gives 1 -- launchd -- and a pid of 0 signals our own process
  // group. Both are far worse than doing nothing, so a spawn that never
  // started is reported, not signalled.
  if (!Number.isInteger(sidecar.pid) || sidecar.pid <= 0) return { kind: "no-pid" };

  const term = signalGroup(deps, sidecar.pid, "SIGTERM");
  if (!term.ok) return { kind: "signal-failed", error: term.error };

  const timedOut = Symbol("timed-out");
  const raced = await Promise.race([
    sidecar.exited.then(() => "graceful" as const),
    deps.sleep(SIGTERM_GRACE_MS).then(() => timedOut),
  ]);
  if (raced !== timedOut) return { kind: "graceful" };

  const killed = signalGroup(deps, sidecar.pid, "SIGKILL");
  if (!killed.ok) return { kind: "signal-failed", error: killed.error };
  return { kind: "killed" };
}
