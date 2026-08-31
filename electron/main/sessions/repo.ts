import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * Whether a directory sits inside a git repository.
 *
 * A filesystem check rather than a call to git: Roster deliberately ships no
 * git code, and this only needs to answer whether asking an agent to make a
 * worktree here is a reasonable thing to do. `.git` is a directory in an
 * ordinary clone and a file inside a worktree, so both count.
 */
export function isGitRepository(dir: string): boolean {
  if (dir === '') return false

  let current = resolve(dir)
  for (;;) {
    if (existsSync(join(current, '.git'))) return true

    const parent = dirname(current)
    if (parent === current) return false
    current = parent
  }
}
