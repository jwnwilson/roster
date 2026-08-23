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
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: { ...augmentedEnv(), ...spec.env },
    // stdin closed: Codex otherwise waits several seconds for piped input.
    stdio: ['ignore', 'pipe', 'pipe'],
    signal: spec.signal,
  })

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

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })

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

  const code = await exited

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
