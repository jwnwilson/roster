import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { RunnerStatus } from '../../../shared/types'
import { builtinRunnerIds, detectRunner, type DetectDeps } from './detect'

const run = promisify(execFile)

/** Probes time-boxed so a hung binary cannot stall app startup. */
const PROBE_TIMEOUT_MS = 3_000

/**
 * A launched .app does not inherit the user's shell PATH on macOS, so the
 * usual install locations are appended before probing.
 */
function probeEnv(): NodeJS.ProcessEnv {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', `${process.env['HOME']}/.local/bin`]
  const current = process.env['PATH'] ?? ''
  const missing = extra.filter((dir) => !current.split(':').includes(dir))
  return { ...process.env, PATH: [current, ...missing].filter(Boolean).join(':') }
}

const realDeps: DetectDeps = {
  async which(command) {
    try {
      const { stdout } = await run('which', [command], {
        timeout: PROBE_TIMEOUT_MS,
        env: probeEnv(),
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
        env: probeEnv(),
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
export async function detectAllRunners(extraIds: string[] = []): Promise<Map<string, RunnerStatus>> {
  const ids = [...new Set([...builtinRunnerIds(), ...extraIds])]
  const statuses = await Promise.all(ids.map((id) => detectRunner(id, realDeps)))
  return new Map(statuses.map((status) => [status.id, status]))
}
