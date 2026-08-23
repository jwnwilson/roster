import { chmod, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { streamJsonLines } from '@main/runners/subprocess'
import type { RunnerEvent } from '@main/runners/types'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'roster-sub-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Writes a throwaway CLI so the helper is exercised against a real process. */
async function fakeCli(body: string): Promise<string> {
  const path = join(dir, 'fake-cli.sh')
  await writeFile(path, `#!/bin/sh\n${body}\n`, 'utf8')
  await chmod(path, 0o755)
  return path
}

/** Echoes each parsed line back as a text event, so parsing is observable. */
const passthrough = (line: unknown): RunnerEvent[] => {
  const record = line as Record<string, unknown>
  if (record['type'] === 'done') return [{ kind: 'done', runnerSessionId: 'sess-1' }]
  return [{ kind: 'text', delta: String(record['text'] ?? '') }]
}

async function collect(iterable: AsyncIterable<RunnerEvent>): Promise<RunnerEvent[]> {
  const events: RunnerEvent[] = []
  for await (const event of iterable) events.push(event)
  return events
}

describe('streamJsonLines — happy path', () => {
  test('parses each JSON line into events', async () => {
    const cli = await fakeCli(`echo '{"text":"one"}'; echo '{"text":"two"}'; echo '{"type":"done"}'`)

    const events = await collect(
      streamJsonLines(
        { command: cli, args: [], cwd: dir, signal: new AbortController().signal },
        passthrough,
      ),
    )

    expect(events).toEqual([
      { kind: 'text', delta: 'one' },
      { kind: 'text', delta: 'two' },
      { kind: 'done', runnerSessionId: 'sess-1' },
    ])
  })

  test('skips blank lines and non-JSON chatter without failing', async () => {
    const cli = await fakeCli(
      `echo ''; echo 'warning: something'; echo '{"text":"real"}'; echo '{"type":"done"}'`,
    )

    const events = await collect(
      streamJsonLines(
        { command: cli, args: [], cwd: dir, signal: new AbortController().signal },
        passthrough,
      ),
    )

    expect(events.filter((e) => e.kind === 'text')).toEqual([{ kind: 'text', delta: 'real' }])
  })

  test('always ends the turn, even when the CLI never says it is done', async () => {
    const cli = await fakeCli(`echo '{"text":"only"}'`)

    const events = await collect(
      streamJsonLines(
        { command: cli, args: [], cwd: dir, signal: new AbortController().signal },
        passthrough,
      ),
    )

    // Otherwise the UI would sit on a spinner forever.
    expect(events.at(-1)).toEqual({ kind: 'done', runnerSessionId: '' })
  })
})

describe('streamJsonLines — failures', () => {
  test('reports a missing working directory rather than a misleading ENOENT', async () => {
    const cli = await fakeCli(`echo '{"type":"done"}'`)

    const events = await collect(
      streamJsonLines(
        { command: cli, args: [], cwd: join(dir, 'nope'), signal: new AbortController().signal },
        passthrough,
      ),
    )

    // spawn reports a missing cwd as ENOENT on the command, which reads as
    // "the CLI is not installed" and sends you looking in the wrong place.
    expect(events[0]).toMatchObject({ kind: 'error' })
    expect((events[0] as { message: string }).message).toMatch(/working directory does not exist/)
    expect(events.at(-1)).toMatchObject({ kind: 'done' })
  })

  test('names the binary when it cannot be started', async () => {
    const events = await collect(
      streamJsonLines(
        {
          command: join(dir, 'does-not-exist'),
          args: [],
          cwd: dir,
          signal: new AbortController().signal,
        },
        passthrough,
      ),
    )

    expect((events[0] as { message: string }).message).toMatch(/could not start/)
  })

  test('surfaces stderr when the CLI exits non-zero', async () => {
    const cli = await fakeCli(`echo 'boom: it failed' >&2; exit 3`)

    const events = await collect(
      streamJsonLines(
        { command: cli, args: [], cwd: dir, signal: new AbortController().signal },
        passthrough,
      ),
    )

    expect((events[0] as { message: string }).message).toContain('boom: it failed')
  })

  test('falls back to the exit code when the CLI says nothing', async () => {
    const cli = await fakeCli(`exit 7`)

    const events = await collect(
      streamJsonLines(
        { command: cli, args: [], cwd: dir, signal: new AbortController().signal },
        passthrough,
      ),
    )

    expect((events[0] as { message: string }).message).toMatch(/exited with code 7/)
  })

  test('a clean exit after output produces no error', async () => {
    const cli = await fakeCli(`echo '{"type":"done"}'; exit 0`)

    const events = await collect(
      streamJsonLines(
        { command: cli, args: [], cwd: dir, signal: new AbortController().signal },
        passthrough,
      ),
    )

    expect(events.some((e) => e.kind === 'error')).toBe(false)
  })
})

describe('streamJsonLines — cancellation', () => {
  test('aborting stops the process and still ends the turn', async () => {
    // Long enough that the abort is what ends the stream, short enough that a
    // failure surfaces as an assertion rather than a suite-wide timeout.
    const cli = await fakeCli(`echo '{"text":"first"}'; sleep 5; echo '{"type":"done"}'`)
    const controller = new AbortController()

    const events: RunnerEvent[] = []
    const iterable = streamJsonLines(
      { command: cli, args: [], cwd: dir, signal: controller.signal },
      passthrough,
    )

    for await (const event of iterable) {
      events.push(event)
      if (event.kind === 'text') controller.abort()
    }

    expect(events[0]).toEqual({ kind: 'text', delta: 'first' })
    expect(events.at(-1)).toMatchObject({ kind: 'done' })
  }, 30_000)
})
