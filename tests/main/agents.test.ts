import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { RunnerStatus } from '@shared/types'
import { AgentStore } from '@main/store/agents'

let home: string

const READY: RunnerStatus = {
  id: 'claude',
  provider: 'Anthropic',
  installed: true,
  ready: true,
  auth: 'subscription',
}

const LOGGED_OUT: RunnerStatus = {
  ...READY,
  ready: false,
  auth: 'none',
  detail: 'not signed in — run `claude auth login`',
}

function statusMap(...statuses: RunnerStatus[]) {
  return () => new Map(statuses.map((s) => [s.id, s]))
}

async function writeAgent(id: string, body: string): Promise<void> {
  await mkdir(join(home, 'agents', id), { recursive: true })
  await writeFile(join(home, 'agents', id, 'agent.toml'), body, 'utf8')
}

const VALID = `
name = "Debugging Agent"
runner = "claude"
model = "claude-opus-5"
cwd = "/work/api"
skills = ["repro-harness"]
`

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'roster-test-'))
  process.env['ROSTER_HOME'] = home
})

afterEach(async () => {
  delete process.env['ROSTER_HOME']
  await rm(home, { recursive: true, force: true })
})

describe('AgentStore.load', () => {
  test('reads every agent directory', async () => {
    await writeAgent('debug', VALID)
    await writeAgent('review', VALID.replace('Debugging Agent', 'Review Agent'))

    const store = new AgentStore(statusMap(READY))
    await store.load()

    expect(store.findAll().map((a) => a.name)).toEqual(['Debugging Agent', 'Review Agent'])
  })

  test('creates the agents directory when it does not exist yet', async () => {
    const store = new AgentStore(statusMap(READY))
    await store.load()

    expect(store.findAll()).toEqual([])
  })

  test('ignores a directory with no agent.toml', async () => {
    await mkdir(join(home, 'agents', 'not-an-agent'), { recursive: true })

    const store = new AgentStore(statusMap(READY))
    await store.load()

    expect(store.findAll()).toEqual([])
  })

  test('sorts agents by name', async () => {
    await writeAgent('z', VALID.replace('Debugging Agent', 'Zeta'))
    await writeAgent('a', VALID.replace('Debugging Agent', 'Alpha'))

    const store = new AgentStore(statusMap(READY))
    await store.load()

    expect(store.findAll().map((a) => a.name)).toEqual(['Alpha', 'Zeta'])
  })
})

describe('AgentStore — runner availability drives status', () => {
  test('an agent with a ready runner is idle', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    expect(store.findById('debug')?.status).toBe('idle')
  })

  test('an agent whose runner is logged out is in error with the reason', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(LOGGED_OUT))
    await store.load()

    const agent = store.findById('debug')
    expect(agent?.status).toBe('error')
    expect(agent?.statusDetail).toMatch(/claude auth login/)
  })

  test('an agent naming a runner Roster has never heard of is in error', async () => {
    await writeAgent('debug', VALID.replace('runner = "claude"', 'runner = "ghost"') + '\n[custom]\ncommand = "ghost"\n')
    const store = new AgentStore(statusMap(READY))
    await store.load()

    expect(store.findById('debug')?.status).toBe('error')
  })
})

describe('AgentStore — a broken file does not hide the others', () => {
  test('surfaces the invalid agent in error and still returns the valid one', async () => {
    await writeAgent('good', VALID)
    await writeAgent('bad', 'name = "Broken"\nrunner = "claude"\ncwd = "/tmp"\n') // no model

    const store = new AgentStore(statusMap(READY))
    await store.load()

    const all = store.findAll()
    expect(all).toHaveLength(2)
    expect(all.find((a) => a.id === 'good')?.status).toBe('idle')

    const broken = all.find((a) => a.id === 'bad')
    expect(broken?.status).toBe('error')
    expect(broken?.statusDetail).toMatch(/model/)
  })
})

describe('AgentStore.update', () => {
  test('writes the change back to agent.toml', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    await store.update('debug', { model: 'claude-sonnet-5' })

    const onDisk = await readFile(join(home, 'agents', 'debug', 'agent.toml'), 'utf8')
    expect(onDisk).toContain('claude-sonnet-5')
  })

  test('leaves untouched fields alone', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    const updated = await store.update('debug', { model: 'claude-sonnet-5' })

    expect(updated.name).toBe('Debugging Agent')
    expect(updated.skills).toEqual(['repro-harness'])
  })

  test('survives a reload, proving the write is the source of truth', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(READY))
    await store.load()
    await store.update('debug', { systemPrompt: 'Reproduce before you fix.' })

    const reopened = new AgentStore(statusMap(READY))
    await reopened.load()

    expect(reopened.findById('debug')?.systemPrompt).toBe('Reproduce before you fix.')
  })

  test('rejects an unknown agent rather than creating one', async () => {
    const store = new AgentStore(statusMap(READY))
    await store.load()

    await expect(store.update('ghost', { model: 'x' })).rejects.toThrow(/unknown agent/)
  })
})

describe('AgentStore.watch', () => {
  /**
   * Recursive fs.watch is backed by FSEvents on macOS, which takes a moment to
   * arm after the call returns. Writing immediately races that startup, so
   * these tests wait before mutating.
   */
  const ARM_MS = 250

  test('notifies listeners when a file changes outside Roster', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    const changed = new Promise<string>((resolve) => {
      store.watch((agents) => {
        const name = agents.find((a) => a.id === 'debug')?.name
        if (name === 'Renamed By Hand') resolve(name)
      })
    })
    await new Promise((r) => setTimeout(r, ARM_MS))

    await writeAgent('debug', VALID.replace('Debugging Agent', 'Renamed By Hand'))

    await expect(changed).resolves.toBe('Renamed By Hand')
    store.dispose()
  })

  test('picks up an agent added while running', async () => {
    const store = new AgentStore(statusMap(READY))
    await store.load()

    const added = new Promise<number>((resolve) => {
      store.watch((agents) => {
        if (agents.length === 1) resolve(agents.length)
      })
    })
    await new Promise((r) => setTimeout(r, ARM_MS))

    await writeAgent('brand-new', VALID)

    await expect(added).resolves.toBe(1)
    store.dispose()
  })

  test('dispose stops delivery to that listener', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    let calls = 0
    const sub = store.watch(() => {
      calls += 1
    })
    await new Promise((r) => setTimeout(r, ARM_MS))
    sub.dispose()

    // FSEvents can replay writes from just before the watch armed, so the
    // count may already be non-zero. What matters is that it stops moving.
    const afterDispose = calls

    await writeAgent('debug', VALID.replace('Debugging Agent', 'Changed'))
    await new Promise((r) => setTimeout(r, 400))

    expect(calls).toBe(afterDispose)
    store.dispose()
  })
})
