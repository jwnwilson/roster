import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ProjectNotesStore } from '@main/store/projectNotes'
import { buildMemoryTools, MEMORY_TOOL_NAMES, type MemoryTools } from '@main/runners/memoryTools'

/**
 * The `memory` tools themselves, against a real notes file.
 *
 * Its sibling projectMemory.test.ts mocks this module to get hold of the
 * MemoryTools the session manager builds, so the handlers are exercised from
 * here instead — the same split taskTools has.
 */

let home: string
let notes: ProjectNotesStore

const PROJECT = 'p1'

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'roster-memtools-'))
  process.env['ROSTER_HOME'] = home
  notes = new ProjectNotesStore(() => new Date(2026, 8, 5, 12, 0, 0))
  await notes.load()
})

afterEach(async () => {
  notes.dispose()
  delete process.env['ROSTER_HOME']
  await rm(home, { recursive: true, force: true })
})

interface ToolResult {
  isError?: boolean
  content: { text: string }[]
}

type Handler = (args: never) => Promise<ToolResult>

/** A stand-in for the SDK factory: records each tool by the name it is given. */
function handlers(memory: MemoryTools): Map<string, Handler> {
  const built = new Map<string, Handler>()
  const factory = ((name: string, _description: string, _schema: unknown, handler: Handler) => {
    built.set(name, handler)
    return { name }
  }) as never

  buildMemoryTools(memory, factory)
  return built
}

function tools(): Map<string, Handler> {
  return handlers({
    recall: () => notes.read(PROJECT),
    remember: (note) => notes.append(PROJECT, { author: 'Debugging Agent', note }),
  })
}

function handler(name: string): Handler {
  const found = tools().get(name)
  if (!found) throw new Error(`${name} was never built`)
  return found
}

describe('the memory server', () => {
  test('registers exactly the tools the runner allows', () => {
    const registered = [...tools().keys()].map((name) => `mcp__memory__${name}`)

    // A tool missing from the allowlist does not fail loudly — it blocks on
    // the approval gate forever, so the two lists must not drift.
    expect(registered.sort()).toEqual([...MEMORY_TOOL_NAMES].sort())
  })
})

describe('recall', () => {
  test('says so plainly when nothing has been written yet', async () => {
    const result = await handler('recall')(undefined as never)

    expect(result.content[0]?.text).toMatch(/no notes/i)
    expect(result.isError).toBeUndefined()
  })

  test('returns the notes as they are on disk', async () => {
    await notes.append(PROJECT, { author: 'Review Agent', note: 'one pool per process' })

    const result = await handler('recall')(undefined as never)
    expect(result.content[0]?.text).toContain('one pool per process')
  })
})

describe('remember', () => {
  test('appends one dated, attributed line', async () => {
    await handler('remember')({ note: 'release() double-frees on retry' } as never)

    expect(notes.read(PROJECT)).toContain(
      '- 2026-09-05 Debugging Agent: release() double-frees on retry',
    )
  })

  test('adds to what is there rather than replacing it', async () => {
    await handler('remember')({ note: 'the first finding' } as never)
    await handler('remember')({ note: 'the second finding' } as never)

    const body = notes.read(PROJECT)
    expect(body).toContain('the first finding')
    expect(body).toContain('the second finding')
  })

  test('reports an empty note rather than writing a blank line', async () => {
    const result = await handler('remember')({ note: '   ' } as never)

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/empty/i)
  })

  test('reports a failure to write instead of claiming it worked', async () => {
    const broken = handlers({
      recall: () => '',
      remember: () => Promise.reject(new Error('read-only file system')),
    }).get('remember')
    if (!broken) throw new Error('remember was never built')

    const result = await broken({ note: 'a finding' } as never)
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('read-only file system')
  })
})
