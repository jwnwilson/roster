import { spawnSync } from 'node:child_process'
import { sep } from 'node:path'

/** Brackets the PATH in the shell's output, so rc-file chatter cannot be mistaken for it. */
const MARK = '\u0001PATH\u0001'

/** The install locations a launched .app is missing, appended after everything else. */
const INSTALL_DIRS = ['/opt/homebrew/bin', '/usr/local/bin']

/** Pulls the PATH out of a login shell's output, or null if it printed none. */
export function loginShellPath(output: string): string | null {
  const start = output.indexOf(MARK)
  if (start === -1) return null
  const end = output.indexOf(MARK, start + MARK.length)
  if (end === -1) return null
  return output.slice(start + MARK.length, end)
}

/**
 * Joins PATH entries in order, keeping each directory once. The bundled
 * `node_modules/.bin` copies are dropped, so Roster never runs a CLI from its
 * own dependencies in place of the one the user installed.
 */
export function mergePath(...sources: [login: string, inherited: string, extras: string[]]): string {
  const [login, inherited, extras] = sources
  const seen = new Set<string>()
  const dirs: string[] = []
  for (const dir of [...login.split(':'), ...inherited.split(':'), ...extras]) {
    if (dir === '' || dir.includes(`${sep}node_modules${sep}.bin`) || seen.has(dir)) continue
    seen.add(dir)
    dirs.push(dir)
  }
  return dirs.join(':')
}

/**
 * Asks the user's login shell for its PATH. Interactive, because nvm and
 * similar tools set PATH in .zshrc, which a non-interactive shell never reads.
 */
export function readLoginShellPath(shell = process.env['SHELL'] ?? '/bin/zsh'): string {
  const result = spawnSync(shell, ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`], {
    encoding: 'utf8',
    timeout: 5_000,
  })
  return loginShellPath(result.stdout ?? '') ?? ''
}

/**
 * Makes this process's PATH the one a terminal would have. A packaged app
 * opened from Finder inherits only the system PATH, so `npx` and `node` are
 * missing and every MCP server that runs through them fails to start.
 */
export function adoptLoginPath(read: () => string = readLoginShellPath): void {
  const inherited = process.env['PATH'] ?? ''
  process.env['PATH'] = mergePath(read(), inherited, [...INSTALL_DIRS, `${process.env['HOME']}/.local/bin`])
}
