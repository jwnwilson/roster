import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export interface GitMetadata {
  root: string
  gitDir: string
  commonDir: string
}

/**
 * Whether a directory sits inside a git repository.
 *
 * A filesystem check rather than a call to git: Roster deliberately ships no
 * git code, and this only needs to answer whether asking an agent to make a
 * worktree here is a reasonable thing to do. `.git` is a directory in an
 * ordinary clone and a file inside a worktree, so both count.
 */
export function isGitRepository(dir: string): boolean {
  return gitMetadata(dir) !== null
}

/**
 * Resolve the paths Git itself mutates for a checkout.
 *
 * A linked worktree's `.git` is a pointer to a worktree-specific gitdir, whose
 * `commondir` points back at the shared repository metadata. Both paths need
 * to be writable for branch, index, commit, and worktree operations.
 */
export function gitMetadata(dir: string): GitMetadata | null {
  if (dir === '') return null

  let current = resolve(dir)
  for (;;) {
    const marker = join(current, '.git')
    if (existsSync(marker)) {
      const gitDir = resolveGitDir(current, marker)
      if (gitDir === null) return null

      return {
        root: current,
        gitDir,
        commonDir: resolveCommonDir(gitDir),
      }
    }

    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function resolveGitDir(root: string, marker: string): string | null {
  try {
    if (statSync(marker).isDirectory()) return marker

    const match = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(marker, 'utf8'))
    return match?.[1] ? resolve(root, match[1]) : null
  } catch {
    return null
  }
}

function resolveCommonDir(gitDir: string): string {
  try {
    const common = readFileSync(join(gitDir, 'commondir'), 'utf8').trim()
    return common === '' ? gitDir : resolve(gitDir, common)
  } catch {
    return gitDir
  }
}
