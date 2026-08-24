import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { sep } from 'node:path'
import { promisify } from 'node:util'
import type { RunnerStatus } from '../../../shared/types'
import { builtinRunnerIds, detectRunner, type DetectDeps } from './detect'

const run = promisify(execFile)

/** Probes time-boxed so a hung binary cannot stall app startup. */
const PROBE_TIMEOUT_MS = 3_000

/**
 * The PATH Roster probes and spawns with.
 *
 * Two corrections to the inherited PATH:
 *  - `node_modules/.bin` is removed. Roster's own dependencies ship copies of
 *    these CLIs, and driving a bundled copy instead of the user's installed
 *    one would defeat the point of running on their account.
 *  - The usual install locations are appended, since a launched .app on macOS
 *    does not inherit the user's shell PATH.
 */
export function augmentedEnv(): NodeJS.ProcessEnv {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', `${process.env['HOME']}/.local/bin`]
  const inherited = (process.env['PATH'] ?? '')
    .split(':')
    .filter((dir) => dir !== '' && !dir.includes(`${sep}node_modules${sep}.bin`))

  const missing = extra.filter((dir) => !inherited.includes(dir))
  return { ...process.env, PATH: [...inherited, ...missing].join(':') }
}

const realDeps: DetectDeps = {
  async which(command) {
    try {
      const { stdout } = await run('which', [command], {
        timeout: PROBE_TIMEOUT_MS,
        env: augmentedEnv(),
      })
      const path = stdout.trim()
      return path === '' ? null : path
    } catch {
      return null
    }
  },

  async version(command) {
    try {
      const { stdout } = await run(command, ['--version'], {
        timeout: PROBE_TIMEOUT_MS,
        env: augmentedEnv(),
      })
      // "2.1.241 (Claude Code)" and "codex-cli 0.147.0" both reduce to a number.
      return /\d+\.\d+\.\d+/.exec(stdout)?.[0] ?? stdout.trim().split('\n')[0] ?? null
    } catch {
      return null
    }
  },

  async readFile(path) {
    try {
      return await readFile(path, 'utf8')
    } catch {
      return null
    }
  },

  async keychainHas(service) {
    if (process.platform !== 'darwin') return false
    try {
      await run('security', ['find-generic-password', '-s', service, '-w'], {
        timeout: PROBE_TIMEOUT_MS,
      })
      return true
    } catch {
      return false
    }
  },

  env: process.env,
}

/**
 * Detects every builtin runner plus any extra ids in use by custom agents.
 * Cached by the caller; re-run when the user asks Roster to re-check.
 */
/** A custom runner, which is named by its user and may run any binary. */
export interface CustomProbe {
  id: string
  command: string
}

export async function detectAllRunners(
  extra: readonly CustomProbe[] = [],
): Promise<Map<string, RunnerStatus>> {
  const builtin = builtinRunnerIds().map((id) => ({ id, command: id }))
  const byId = new Map<string, CustomProbe>()
  for (const probe of [...builtin, ...extra]) byId.set(probe.id, probe)

  const statuses = await Promise.all(
    [...byId.values()].map((probe) => detectRunner(probe.id, realDeps, probe.command)),
  )
  return new Map(statuses.map((status) => [status.id, status]))
}
