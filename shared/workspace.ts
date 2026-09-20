import type { Agent, ProjectRepo, Session } from './types'

/**
 * Where a session's turns run, and what else they can reach.
 *
 * Shared rather than main-only because two places have to agree on it: the
 * session manager, which hands `root` to the runner, and the config rail,
 * which tells the user where the turn is about to go. Two implementations of
 * this would eventually disagree, and the disagreement would show up as the
 * app confidently naming the wrong directory.
 */
export interface Workspace {
  /** The turn's cwd, and where the terminal opens. */
  root: string
  /** `root` with the home directory collapsed, for display. */
  rootLabel: string
  /**
   * The project's other repositories. Reachable — an agent working on the API
   * can read the protobufs it has to match — but not where it is standing.
   */
  additional: readonly string[]
  /** The same list, for display. */
  additionalLabels: readonly string[]
  /** Which of the three answers below decided `root`, for the config rail. */
  source: 'session' | 'project' | 'agent'
}

export interface WorkspaceInput {
  agent: Agent
  session: Session
  /** The session's project's repositories, primary first. Empty if none. */
  repos: readonly ProjectRepo[]
}

/**
 * Whether two paths name the same directory, without touching the disk.
 *
 * Trailing separators are the only difference this can resolve — a directory
 * picker and a hand-written path disagree about them constantly. Symlinks and
 * case-folding need the filesystem, so the main process passes its own
 * `samePath` in; see `electron/main/sessions/workspace.ts`.
 *
 * The renderer gets the weaker comparison on purpose. It only ever decides
 * what a label says, never what a runner is granted, so a missed match there
 * shows a directory twice rather than handing out an extra grant.
 */
export function pathsLookEqual(a: string, b: string): boolean {
  return trimTrailing(a) === trimTrailing(b)
}

function trimTrailing(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.replace(/\/+$/, '') : path
}

/**
 * Where this session's work happens.
 *
 * Three answers, most specific first:
 *
 * 1. **What the session already ran in.** `session.workspaceRoot` is written
 *    the first time a turn starts and never rewritten.
 * 2. **The project's primary repository.** This is what makes one agent
 *    reusable across projects: the same persona runs in `~/work/api` on one
 *    and `~/work/payments` on another, without being duplicated.
 * 3. **`agent.cwd`.** Yesterday's behaviour, and still the answer for every
 *    unfiled session and every project nobody has named a repository on.
 *
 * **Why the pin is a path and not a repository id.** A row id is silently
 * invalidated by reordering, editing or removing a repository, and by
 * deleting the project. In each of those a resumed Codex thread keeps running
 * in the directory it started in — `codex exec resume` inherits its cwd from
 * the stored session and rejects `-C` — while the rail and the brief would
 * both claim the new one. Storing the resolved path survives all four.
 *
 * **Why it is written once.** Same reason. If the answer could move under a
 * live session, Claude would follow it and Codex would not, and one setting
 * would mean two things depending on the runner.
 */
export function resolveWorkspace(
  input: WorkspaceInput,
  samePath: (a: string, b: string) => boolean = pathsLookEqual,
): Workspace {
  const { agent, session, repos } = input

  const primary = repos[0]
  const pinned = session.workspaceRoot ?? null

  const root = pinned ?? primary?.path ?? agent.cwd
  const source: Workspace['source'] =
    pinned !== null ? 'session' : primary !== undefined ? 'project' : 'agent'

  // Deduplicated through samePath rather than ===: the root may have arrived
  // from the session pin or from agent.cwd and be spelled differently from
  // the repository row naming the same directory. Handing one directory to a
  // runner twice is at best noise and at worst a second, conflicting grant.
  const others = repos.filter((repo) => !samePath(repo.path, root))

  return {
    root,
    rootLabel: labelFor(root, input, samePath),
    additional: others.map((repo) => repo.path),
    additionalLabels: others.map((repo) => repo.pathLabel),
    source,
  }
}

/**
 * A display label for the resolved root.
 *
 * Taken from whichever record already holds one — the repository row or the
 * agent — because collapsing `~` needs the home directory, and the renderer
 * has no business knowing it.
 */
function labelFor(
  root: string,
  { agent, repos }: WorkspaceInput,
  samePath: (a: string, b: string) => boolean,
): string {
  const named = repos.find((repo) => samePath(repo.path, root))
  if (named) return named.pathLabel
  if (samePath(agent.cwd, root)) return agent.cwdLabel

  // A pinned directory that is no longer on the project and is not the
  // agent's own. Shown as it is rather than guessed at.
  return root
}
