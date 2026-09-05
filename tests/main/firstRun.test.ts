import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { RunnerStatus } from '@shared/types'
import { AgentStore } from '@main/store/agents'
import { defaultAgentsFor, TECH_LEAD } from '@main/store/defaultAgents'
import { dismissSetup, prepareFirstRun } from '@main/store/firstRun'
import { readSetupRecord } from '@main/store/setupState'
import { setupStatePath } from '@main/store/paths'

let home: string

const CLAUDE_READY: RunnerStatus = {
  id: 'claude',
  provider: 'Anthropic',
  installed: true,
  ready: true,
  auth: 'subscription',
}

const CLAUDE_LOGGED_OUT: RunnerStatus = {
  ...CLAUDE_READY,
  ready: false,
  auth: 'none',
  detail: 'not signed in — run `claude auth login`',
}

const CLAUDE_MISSING: RunnerStatus = {
  id: 'claude',
  provider: 'Anthropic',
  installed: false,
  ready: false,
  auth: 'none',
  detail: 'claude is not installed',
}

const CODEX_READY: RunnerStatus = {
  id: 'codex',
  provider: 'OpenAI',
  installed: true,
  ready: true,
  auth: 'subscription',
}

const GEMINI_READY: RunnerStatus = {
  id: 'gemini',
  provider: 'Google',
  installed: true,
  ready: true,
  auth: 'subscription',
}

function runnerMap(...statuses: RunnerStatus[]): Map<string, RunnerStatus> {
  return new Map(statuses.map((status) => [status.id, status]))
}

function storeWith(...statuses: RunnerStatus[]): AgentStore {
  return new AgentStore(() => runnerMap(...statuses))
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'roster-first-run-'))
  process.env['ROSTER_HOME'] = home
})

afterEach(async () => {
  delete process.env['ROSTER_HOME']
  await rm(home, { recursive: true, force: true })
})

describe('defaultAgentsFor', () => {
  test('leads with the Tech Lead, so the recommendation is the first agent', () => {
    const [first] = defaultAgentsFor(runnerMap(CLAUDE_READY))
    expect(first?.name).toBe(TECH_LEAD)
  })

  test('gives every default agent a working directory and a prompt', () => {
    const defaults = defaultAgentsFor(runnerMap(CLAUDE_READY))

    expect(defaults.length).toBeGreaterThan(1)
    for (const spec of defaults) {
      expect(spec.cwd).not.toBe('')
      expect(spec.systemPrompt).not.toBe('')
      expect(spec.model).not.toBe('')
    }
  })

  test('uses a runner that is installed and signed in', () => {
    const defaults = defaultAgentsFor(runnerMap(CLAUDE_READY, CODEX_READY))
    expect(defaults.every((spec) => spec.runner === 'claude')).toBe(true)
  })

  test('falls back to another runner when the preferred one is not installed', () => {
    const defaults = defaultAgentsFor(runnerMap(CLAUDE_MISSING, CODEX_READY))
    expect(defaults.every((spec) => spec.runner === 'codex')).toBe(true)
  })

  test('still seeds against an installed runner that is only logged out', () => {
    const defaults = defaultAgentsFor(runnerMap(CLAUDE_LOGGED_OUT))
    expect(defaults.every((spec) => spec.runner === 'claude')).toBe(true)
  })

  test('prefers a signed-in runner over an installed but logged-out one', () => {
    const defaults = defaultAgentsFor(runnerMap(CLAUDE_LOGGED_OUT, CODEX_READY))
    expect(defaults.every((spec) => spec.runner === 'codex')).toBe(true)
  })

  test('seeds nothing when no runner Roster can drive is installed', () => {
    expect(defaultAgentsFor(runnerMap(CLAUDE_MISSING))).toEqual([])
    expect(defaultAgentsFor(new Map())).toEqual([])
  })

  test('ignores a runner Roster has no adapter for', () => {
    // gemini is detected but has no Runner implementation, so an agent
    // pointed at it could never take a turn.
    expect(defaultAgentsFor(runnerMap(GEMINI_READY))).toEqual([])
  })
})

describe('prepareFirstRun', () => {
  test('seeds the default agents on a genuinely fresh install', async () => {
    const store = storeWith(CLAUDE_READY)
    await store.load()

    const state = await prepareFirstRun(store, runnerMap(CLAUDE_READY))

    expect(state.pending).toBe(true)
    expect(state.startingAgentId).toBe('tech-lead')
    expect(state.seededAgentIds).toContain('tech-lead')
    expect(store.findById('tech-lead')?.name).toBe(TECH_LEAD)
  })

  test('records a marker rather than relying on an empty roster', async () => {
    const store = storeWith(CLAUDE_READY)
    await store.load()

    await prepareFirstRun(store, runnerMap(CLAUDE_READY))

    const record = await readSetupRecord()
    expect(record?.seededAgentIds).toContain('tech-lead')
    expect(record?.startingAgentId).toBe('tech-lead')
  })

  test('seeds once, so a restart does not duplicate the roster', async () => {
    const first = storeWith(CLAUDE_READY)
    await first.load()
    await prepareFirstRun(first, runnerMap(CLAUDE_READY))
    const seeded = first.findAll().length

    const second = storeWith(CLAUDE_READY)
    await second.load()
    await prepareFirstRun(second, runnerMap(CLAUDE_READY))

    expect(second.findAll()).toHaveLength(seeded)
  })

  test('never re-adds an agent the user deleted', async () => {
    const first = storeWith(CLAUDE_READY)
    await first.load()
    await prepareFirstRun(first, runnerMap(CLAUDE_READY))

    await rm(join(home, 'agents', 'tech-lead'), { recursive: true, force: true })

    const second = storeWith(CLAUDE_READY)
    await second.load()
    const state = await prepareFirstRun(second, runnerMap(CLAUDE_READY))

    expect(second.findById('tech-lead')).toBeNull()
    // Nothing to start with any more, so the card must not offer it.
    expect(state.startingAgentId).toBeNull()
  })

  test('leaves an existing roster alone when it predates the marker', async () => {
    await mkdir(join(home, 'agents', 'mine'), { recursive: true })
    await writeFile(
      join(home, 'agents', 'mine', 'agent.toml'),
      'name = "Mine"\nrunner = "claude"\nmodel = "claude-opus-5"\ncwd = "~/work"\n',
      'utf8',
    )

    const store = storeWith(CLAUDE_READY)
    await store.load()
    const state = await prepareFirstRun(store, runnerMap(CLAUDE_READY))

    expect(store.findAll().map((a) => a.id)).toEqual(['mine'])
    // An upgrade must not open onto a setup card.
    expect(state.pending).toBe(false)
    expect(await readSetupRecord()).not.toBeNull()
  })

  test('explains itself rather than seeding when no runner is installed', async () => {
    const store = storeWith(CLAUDE_MISSING)
    await store.load()

    const state = await prepareFirstRun(store, runnerMap(CLAUDE_MISSING))

    expect(state.seededAgentIds).toEqual([])
    expect(state.noRunner).toBe(true)
    expect(state.pending).toBe(true)
    // No marker: installing a CLI later must still get the default agents.
    expect(await readSetupRecord()).toBeNull()
  })

  test('stays dismissed once the user has dismissed it', async () => {
    const first = storeWith(CLAUDE_READY)
    await first.load()
    await prepareFirstRun(first, runnerMap(CLAUDE_READY))
    await dismissSetup()

    const second = storeWith(CLAUDE_READY)
    await second.load()
    const state = await prepareFirstRun(second, runnerMap(CLAUDE_READY))

    expect(state.pending).toBe(false)
  })

  test('treats an unreadable marker as already set up rather than seeding again', async () => {
    await mkdir(home, { recursive: true })
    await writeFile(setupStatePath(), '{ not json', 'utf8')

    const store = storeWith(CLAUDE_READY)
    await store.load()
    const state = await prepareFirstRun(store, runnerMap(CLAUDE_READY))

    expect(store.findAll()).toEqual([])
    expect(state.pending).toBe(false)
  })

  test('tolerates a marker whose fields have the wrong shape', async () => {
    await mkdir(home, { recursive: true })
    await writeFile(
      setupStatePath(),
      JSON.stringify({ seededAgentIds: 'tech-lead', startingAgentId: 7 }),
      'utf8',
    )

    const store = storeWith(CLAUDE_READY)
    await store.load()
    const state = await prepareFirstRun(store, runnerMap(CLAUDE_READY))

    expect(state.seededAgentIds).toEqual([])
    expect(state.startingAgentId).toBeNull()
    expect(store.findAll()).toEqual([])
  })
})

describe('dismissSetup', () => {
  test('writes a marker even when nothing was ever seeded', async () => {
    const state = await dismissSetup()

    expect(state.pending).toBe(false)
    expect(await readSetupRecord()).not.toBeNull()
    await expect(readFile(setupStatePath(), 'utf8')).resolves.toContain('dismissedAt')
  })

  test('keeps what was seeded, so the record still says where the roster came from', async () => {
    const store = storeWith(CLAUDE_READY)
    await store.load()
    await prepareFirstRun(store, runnerMap(CLAUDE_READY))

    const state = await dismissSetup()

    expect(state.seededAgentIds).toContain('tech-lead')
    expect(state.pending).toBe(false)
  })
})
