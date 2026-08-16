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

function signalGroup(deps: StopDeps, pid: number, signal: NodeJS.Signals): void {
  try {
    // Negative pid signals the process group. uvicorn is a grandchild of the
    // spawn, so signalling only the recorded pid leaves it running.
    deps.kill(-pid, signal);
  } catch {
    // ESRCH: already gone. Stopping something that stopped is not an error.
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
export async function stopSidecar(
  sidecar: Sidecar,
  deps: StopDeps,
): Promise<"graceful" | "killed"> {
  signalGroup(deps, sidecar.pid, "SIGTERM");

  const timedOut = Symbol("timed-out");
  const outcome = await Promise.race([
    sidecar.exited.then(() => "graceful" as const),
    deps.sleep(SIGTERM_GRACE_MS).then(() => timedOut),
  ]);

  if (outcome === timedOut) {
    signalGroup(deps, sidecar.pid, "SIGKILL");
    return "killed";
  }
  return "graceful";
}
