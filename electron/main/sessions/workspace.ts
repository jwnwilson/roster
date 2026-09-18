import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { expandHome } from '../store/agentToml'

/**
 * Where work happens, and how two answers to that question are compared.
 *
 * Until a project could name its repositories there was only one directory in
 * Roster — `agent.cwd` — and nothing ever had to ask whether two paths meant
 * the same place. Now the project, the session and the agent can each supply
 * one, and they arrive from different sources: a native directory picker, a
 * hand-edited TOML file, and a column written months ago.
 */

/**
 * Whether two paths name the same directory.
 *
 * A plain `===` on two absolute paths silently never matches, and the failure
 * is invisible — the brief just stops marking where the agent is standing,
 * and the workspace stops deduplicating. Four things have to be normalised
 * away before the comparison means anything:
 *
 * - `~`, because `agent.cwd` is expanded on read but a hand-written TOML or a
 *   stored repository path may not be.
 * - trailing separators and `.` segments, because a directory picker and a
 *   typed path do not agree about them.
 * - symlinks, because `~/work` is very often one.
 * - case, on darwin only, because APFS folds it by default and `/Users/x/API`
 *   and `/Users/x/api` are one directory there and two on Linux.
 *
 * `realpath` is attempted and tolerated rather than required: a repository the
 * user has since moved or deleted must still compare equal to itself, and a
 * path that cannot be resolved is compared as written.
 */
export function samePath(a: string, b: string): boolean {
  const left = canonicalPath(a)
  const right = canonicalPath(b)

  return process.platform === 'darwin'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

/**
 * One path, in the form everything else should store and compare.
 *
 * Exported because the write path needs it too: `project_repos` carries a
 * `UNIQUE (project_id, path)` index, and an index over unnormalised strings
 * would happily hold `~/api`, `/Users/n/api` and `/Users/n/api/` as three
 * different repositories on the same project.
 *
 * Case is deliberately *not* folded here — that belongs to the comparison,
 * not to the stored value. Lowercasing a path on the way into the database
 * would corrupt the display of every case-sensitive directory name.
 */
export function canonicalPath(path: string): string {
  const absolute = resolve(expandHome(path))

  try {
    return realpathSync.native(absolute)
  } catch {
    // The directory does not exist, or is not readable. Comparing the
    // resolved form is the best available answer, and a repository that has
    // been moved away must still equal itself.
    return absolute
  }
}
