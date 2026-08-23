import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { augmentedEnv } from '../auth/probes'
import type { RunnerEvent } from './types'

export interface SubprocessSpec {
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string>
  signal: AbortSignal
}

/**
 * Runs a CLI that emits JSONL on stdout and yields each parsed line.
 *
 * Shared by the Codex and custom runners: the difference between them is only
 * which normalizer interprets the lines.
 */
export async function* streamJsonLines(
  spec: SubprocessSpec,
  normalize: (line: unknown) => RunnerEvent[],
): AsyncIterable<RunnerEvent> {
  // Checked up front because spawn reports a missing cwd as ENOENT on the
  // command, which reads as "the CLI is not installed" and sends you hunting
  // in the wrong place entirely.
  if (!existsSync(spec.cwd)) {
    yield { kind: 'error', message: `working directory does not exist: ${spec.cwd}` }
    yield { kind: 'done', runnerSessionId: '' }
    return
  }

  // A launched .app does not inherit the user's shell PATH, so a CLI
  // installed under nvm or homebrew would otherwise fail to spawn.
  //
  // `detached` puts the CLI in its own process group. Agent CLIs spawn their
  // own children (shells, language servers), and killing only the direct
  // child leaves those holding stdout open — the stream never ends and the
  // turn hangs. Cancelling kills the whole group instead.
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: { ...augmentedEnv(), ...spec.env },
    // stdin closed: Codex otherwise waits several seconds for piped input.
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })

  const onAbort = (): void => {
    if (child.pid !== undefined && child.exitCode === null) {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        // Already gone, or the group vanished between the checks.
        child.kill('SIGTERM')
      }
    }
    // Destroying the stream is not enough: readline's async iterator ends on
    // the interface closing, not on its input dying, so a cancelled turn
    // would otherwise hang here forever.
    lines.close()
    child.stdout.destroy()
  }

  if (spec.signal.aborted) onAbort()
  else spec.signal.addEventListener('abort', onAbort, { once: true })

  // stderr is captured so a failure can say why rather than just ending.
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
    if (stderr.length > 8_000) stderr = stderr.slice(-8_000)
  })

  let spawnError: string | null = null
  const exited = new Promise<number>((resolve) => {
    child.on('close', (code) => resolve(code ?? 0))
    child.on('error', (cause: Error) => {
      spawnError = cause.message
      resolve(-1)
    })
  })

  let sawDone = false
  for await (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      // Non-JSON chatter on stdout is not fatal; skip the line.
      continue
    }

    for (const event of normalize(parsed)) {
      if (event.kind === 'done') sawDone = true
      yield event
    }
  }

  spec.signal.removeEventListener('abort', onAbort)
  const code = await exited

  // A cancelled turn is not a failure; the user asked for it.
  if (spec.signal.aborted) {
    yield { kind: 'done', runnerSessionId: '' }
    return
  }

  if (code !== 0) {
    yield { kind: 'error', message: describeFailure(spec.command, code, spawnError, stderr) }
  }

  // Always end the turn, even when the CLI never emitted a completion event.
  if (!sawDone) yield { kind: 'done', runnerSessionId: '' }
}

function describeFailure(
  command: string,
  code: number,
  spawnError: string | null,
  stderr: string,
): string {
  // A spawn failure is not an exit code; say which it was.
  if (spawnError !== null) return `could not start ${command}: ${spawnError}`
  if (stderr.trim() !== '') return stderr.trim().split('\n').slice(-3).join('\n')
  return `${command} exited with code ${code}`
}
