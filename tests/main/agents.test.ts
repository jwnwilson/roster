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

  test('writes hidden back to agent.toml', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    const updated = await store.update('debug', { hidden: true })

    expect(updated.hidden).toBe(true)
    expect(await readFile(join(home, 'agents', 'debug', 'agent.toml'), 'utf8')).toContain(
      'hidden = true',
    )
  })

  test('refuses to change an agent whose agent.toml does not parse', async () => {
    // The old message said "unknown agent", which sent you looking for a
    // missing directory rather than the parse error sitting right there.
    await writeAgent('bad', 'name = "Broken"\nrunner = "claude"\ncwd = "/tmp"\n')
    const store = new AgentStore(statusMap(READY))
    await store.load()

    await expect(store.update('bad', { hidden: true })).rejects.toThrow(
      /does not parse — agent\.toml for "bad".*model/,
    )
  })
})

describe('AgentStore — hidden agents', () => {
  test('still returns a hidden agent, since hiding is the renderer\'s concern', async () => {
    await writeAgent('debug', `${VALID}hidden = true\n`)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    expect(store.findAll().map((a) => a.id)).toEqual(['debug'])
    expect(store.findById('debug')?.hidden).toBe(true)
  })

  test('a fresh agent starts visible', async () => {
    const store = new AgentStore(statusMap(READY))
    await store.load()

    const created = await store.create({
      name: 'Review Agent',
      runner: 'claude',
      model: 'claude-opus-5',
      cwd: join(home, 'workspace'),
      systemPrompt: '',
      skills: [],
    })

    expect(created.hidden).toBe(false)
  })

  test('reports a broken agent as visible so its error cannot be missed', async () => {
    await writeAgent('bad', 'name = "Broken"\nrunner = "claude"\ncwd = "/tmp"\n')
    const store = new AgentStore(statusMap(READY))
    await store.load()

    expect(store.findById('bad')?.hidden).toBe(false)
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

describe('AgentStore.update — renaming', () => {
  test('writes the new name back to agent.toml', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    const renamed = await store.update('debug', { name: 'Triage Agent' })

    expect(renamed.name).toBe('Triage Agent')
    expect(await readFile(join(home, 'agents', 'debug', 'agent.toml'), 'utf8')).toContain(
      'Triage Agent',
    )
  })

  test('keeps the id, so sessions and tasks stay attributed', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    const renamed = await store.update('debug', { name: 'Triage Agent' })

    expect(renamed.id).toBe('debug')
    expect(store.findById('debug')?.name).toBe('Triage Agent')
  })

  test('survives a reload', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(READY))
    await store.load()
    await store.update('debug', { name: 'Triage Agent' })

    const reopened = new AgentStore(statusMap(READY))
    await reopened.load()

    expect(reopened.findById('debug')?.name).toBe('Triage Agent')
  })

  test('trims surrounding whitespace', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    expect((await store.update('debug', { name: '  Triage Agent  ' })).name).toBe('Triage Agent')
  })

  test('rejects a blank name', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    await expect(store.update('debug', { name: '   ' })).rejects.toThrow(/needs a name/)
    expect(store.findById('debug')?.name).toBe('Debugging Agent')
  })

  test('rejects a name that is not text at all, since IPC input is untrusted', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    await expect(store.update('debug', { name: 42 as unknown as string })).rejects.toThrow(
      /must be text/,
    )
  })

  test('rejects a name longer than the limit', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    await expect(store.update('debug', { name: 'x'.repeat(61) })).rejects.toThrow(
      /60 characters/,
    )
  })

  test('rejects a name another agent already answers to, whatever the case', async () => {
    await writeAgent('debug', VALID)
    await writeAgent('review', VALID.replace('Debugging Agent', 'Review Agent'))
    const store = new AgentStore(statusMap(READY))
    await store.load()

    await expect(store.update('debug', { name: 'review agent' })).rejects.toThrow(
      /already an agent named/,
    )
  })

  test('lets an agent keep its own name while recasing it', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    expect((await store.update('debug', { name: 'DEBUGGING AGENT' })).name).toBe('DEBUGGING AGENT')
  })

  test('leaves the name alone when the patch does not mention it', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    expect((await store.update('debug', { model: 'claude-sonnet-5' })).name).toBe('Debugging Agent')
  })
})

describe('AgentStore.create — name validation', () => {
  const base = {
    runner: 'claude',
    model: 'claude-opus-5',
    systemPrompt: '',
    skills: [],
  }

  test('trims the name it is given', async () => {
    const store = new AgentStore(statusMap(READY))
    await store.load()

    const created = await store.create({
      ...base,
      name: '  Review Agent  ',
      cwd: join(home, 'workspace'),
    })

    expect(created.name).toBe('Review Agent')
    expect(created.id).toBe('review-agent')
  })

  test('refuses a blank name rather than writing an unnameable agent', async () => {
    const store = new AgentStore(statusMap(READY))
    await store.load()

    await expect(
      store.create({ ...base, name: '  ', cwd: join(home, 'workspace') }),
    ).rejects.toThrow(/needs a name/)
  })

  test('refuses a name already in the roster', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    await expect(
      store.create({ ...base, name: 'debugging agent', cwd: join(home, 'workspace') }),
    ).rejects.toThrow(/already an agent named/)
  })
})

describe('AgentStore — default project', () => {
  test('an agent without one reports no default', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    expect(store.findById('debug')?.defaultProjectId).toBeNull()
  })

  test('exposes the one named in agent.toml', async () => {
    await writeAgent('debug', `${VALID}default_project = "proj-reliability"\n`)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    expect(store.findById('debug')?.defaultProjectId).toBe('proj-reliability')
  })

  test('writes a new default back to agent.toml', async () => {
    await writeAgent('debug', VALID)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    const updated = await store.update('debug', { defaultProjectId: 'proj-reliability' })

    expect(updated.defaultProjectId).toBe('proj-reliability')
    expect(await readFile(join(home, 'agents', 'debug', 'agent.toml'), 'utf8')).toContain(
      'default_project = "proj-reliability"',
    )
  })

  test('clears it when set back to null', async () => {
    await writeAgent('debug', `${VALID}default_project = "proj-reliability"\n`)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    const updated = await store.update('debug', { defaultProjectId: null })

    expect(updated.defaultProjectId).toBeNull()
    expect(await readFile(join(home, 'agents', 'debug', 'agent.toml'), 'utf8')).not.toContain(
      'default_project',
    )
  })

  test('leaves the default alone when the patch does not mention it', async () => {
    await writeAgent('debug', `${VALID}default_project = "proj-reliability"\n`)
    const store = new AgentStore(statusMap(READY))
    await store.load()

    const updated = await store.update('debug', { model: 'claude-sonnet-5' })

    expect(updated.defaultProjectId).toBe('proj-reliability')
  })

  test('a broken agent reports no default rather than throwing', async () => {
    await writeAgent('bad', 'name = "Broken"\nrunner = "claude"\ncwd = "/tmp"\n')
    const store = new AgentStore(statusMap(READY))
    await store.load()

    expect(store.findById('bad')?.defaultProjectId).toBeNull()
  })
})
