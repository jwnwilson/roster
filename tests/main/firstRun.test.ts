import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { RunnerStatus } from '@shared/types'
import { AgentStore } from '@main/store/agents'
import { defaultAgentsFor, TECH_LEAD } from '@main/store/defaultAgents'
import { dismissSetup, markPermissionsReviewed, prepareFirstRun } from '@main/store/firstRun'
import { readSetupRecord } from '@main/store/setupState'
import { setupStatePath } from '@main/store/paths'

let home: string

const PI_READY: RunnerStatus = {
  id: 'pi',
  provider: 'Pi · anthropic',
  installed: true,
  ready: true,
  auth: 'subscription',
}

const PI_LOGGED_OUT: RunnerStatus = {
  ...PI_READY,
  ready: false,
  auth: 'none',
  detail: 'no model provider is signed in — run `pi` and then `/login`',
}

const PI_BROKEN: RunnerStatus = { ...PI_LOGGED_OUT, installed: false }

const CLAUDE_READY: RunnerStatus = {
  id: 'claude',
  provider: 'Anthropic',
  installed: true,
  ready: true,
  auth: 'subscription',
}

const MODELS = { pi: 'anthropic/claude-sonnet-5' }

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
    const [first] = defaultAgentsFor(runnerMap(PI_READY), MODELS)
    expect(first?.name).toBe(TECH_LEAD)
  })

  test('gives the Tech Lead a task-backed, validated delivery workflow', () => {
    const [lead] = defaultAgentsFor(runnerMap(PI_READY), MODELS)

    expect(lead?.systemPrompt).toContain('Find the task for the request')
    expect(lead?.systemPrompt).toContain('create one before starting')
    expect(lead?.systemPrompt).toContain('Update the task')
    expect(lead?.systemPrompt).toContain('Validate delivered work yourself')
    expect(lead?.systemPrompt).toContain('the task is validated and complete')
  })

  test('gives every default agent a working directory and a prompt', () => {
    const defaults = defaultAgentsFor(runnerMap(PI_READY), MODELS)

    expect(defaults.length).toBeGreaterThan(1)
    for (const spec of defaults) {
      expect(spec.cwd).not.toBe('')
      expect(spec.systemPrompt).not.toBe('')
      expect(spec.model).not.toBe('')
    }
  })

  test('names no skills, because a fresh install has no skill library', () => {
    const defaults = defaultAgentsFor(runnerMap(PI_READY), MODELS)

    // SkillStore reads ~/roster/skills, which a new install creates empty.
    // A seeded agent naming a skill that is not there is dead configuration:
    // the manager filters it out at run time, so all it does is claim an
    // ability on the Edit modal that the agent does not have.
    for (const spec of defaults) {
      expect(spec.skills).toEqual([])
    }
  })

  test('points every default agent at Pi, on the model it was given', () => {
    const defaults = defaultAgentsFor(runnerMap(PI_READY), MODELS)
    expect(defaults.every((spec) => spec.runner === 'pi')).toBe(true)
    expect(defaults.every((spec) => spec.model === MODELS.pi)).toBe(true)
  })

  test('still seeds when Pi has no provider signed in yet', () => {
    // One `/login` then fixes every row, which beats an empty grid.
    const defaults = defaultAgentsFor(runnerMap(PI_LOGGED_OUT))
    expect(defaults.every((spec) => spec.runner === 'pi')).toBe(true)
  })

  test('seeds nothing when Pi itself could not start', () => {
    expect(defaultAgentsFor(runnerMap(PI_BROKEN))).toEqual([])
    expect(defaultAgentsFor(new Map())).toEqual([])
  })

  test('ignores the retired CLI runners', () => {
    expect(defaultAgentsFor(runnerMap(CLAUDE_READY))).toEqual([])
  })
})

describe('prepareFirstRun', () => {
  test('seeds the default agents on a genuinely fresh install', async () => {
    const store = storeWith(PI_READY)
    await store.load()

    const state = await prepareFirstRun(store, runnerMap(PI_READY), MODELS)

    expect(state.pending).toBe(true)
    expect(state.startingAgentId).toBe('tech-lead')
    expect(state.seededAgentIds).toContain('tech-lead')
    expect(store.findById('tech-lead')?.name).toBe(TECH_LEAD)
  })

  test('records a marker rather than relying on an empty roster', async () => {
    const store = storeWith(PI_READY)
    await store.load()

    await prepareFirstRun(store, runnerMap(PI_READY), MODELS)

    const record = await readSetupRecord()
    expect(record?.seededAgentIds).toContain('tech-lead')
    expect(record?.startingAgentId).toBe('tech-lead')
  })

  test('seeds once, so a restart does not duplicate the roster', async () => {
    const first = storeWith(PI_READY)
    await first.load()
    await prepareFirstRun(first, runnerMap(PI_READY), MODELS)
    const seeded = first.findAll().length

    const second = storeWith(PI_READY)
    await second.load()
    await prepareFirstRun(second, runnerMap(PI_READY), MODELS)

    expect(second.findAll()).toHaveLength(seeded)
  })

  test('never re-adds an agent the user deleted', async () => {
    const first = storeWith(PI_READY)
    await first.load()
    await prepareFirstRun(first, runnerMap(PI_READY), MODELS)

    await rm(join(home, 'agents', 'tech-lead'), { recursive: true, force: true })

    const second = storeWith(PI_READY)
    await second.load()
    const state = await prepareFirstRun(second, runnerMap(PI_READY), MODELS)

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

    const store = storeWith(PI_READY)
    await store.load()
    const state = await prepareFirstRun(store, runnerMap(PI_READY), MODELS)

    expect(store.findAll().map((a) => a.id)).toEqual(['mine'])
    // An upgrade must not open onto a setup card.
    expect(state.pending).toBe(false)
    expect(await readSetupRecord()).not.toBeNull()
  })

  test('explains itself rather than seeding when no runner is installed', async () => {
    const store = storeWith(PI_BROKEN)
    await store.load()

    const state = await prepareFirstRun(store, runnerMap(PI_BROKEN))

    expect(state.seededAgentIds).toEqual([])
    expect(state.noRunner).toBe(true)
    expect(state.pending).toBe(true)
    // No marker: installing a CLI later must still get the default agents.
    expect(await readSetupRecord()).toBeNull()
  })

  test('stays dismissed once the user has dismissed it', async () => {
    const first = storeWith(PI_READY)
    await first.load()
    await prepareFirstRun(first, runnerMap(PI_READY), MODELS)
    await dismissSetup()

    const second = storeWith(PI_READY)
    await second.load()
    const state = await prepareFirstRun(second, runnerMap(PI_READY), MODELS)

    expect(state.pending).toBe(false)
  })

  test('treats an unreadable marker as already set up rather than seeding again', async () => {
    await mkdir(home, { recursive: true })
    await writeFile(setupStatePath(), '{ not json', 'utf8')

    const store = storeWith(PI_READY)
    await store.load()
    const state = await prepareFirstRun(store, runnerMap(PI_READY), MODELS)

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

    const store = storeWith(PI_READY)
    await store.load()
    const state = await prepareFirstRun(store, runnerMap(PI_READY), MODELS)

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
    const store = storeWith(PI_READY)
    await store.load()
    await prepareFirstRun(store, runnerMap(PI_READY), MODELS)

    const state = await dismissSetup()

    expect(state.seededAgentIds).toContain('tech-lead')
    expect(state.pending).toBe(false)
  })
})

describe('permissions review', () => {
  test('a fresh install has not reviewed permissions yet', async () => {
    const state = await prepareFirstRun(storeWith(PI_READY), runnerMap(PI_READY), MODELS)

    expect(state.permissionsReviewed).toBe(false)
  })

  test('an established roster that predates the marker still reviews them on its first session', async () => {
    // Upgrading users have never seen the permissions step, so it must not be
    // skipped just because their roster already exists.
    const agents = storeWith(PI_READY)
    await agents.create({
      name: 'Existing', runner: 'pi', model: 'm', systemPrompt: '', skills: [], cwd: home,
    })

    const state = await prepareFirstRun(agents, runnerMap(PI_READY), MODELS)

    expect(state.permissionsReviewed).toBe(false)
  })

  test('marking them reviewed is kept, so the card does not come back', async () => {
    await prepareFirstRun(storeWith(PI_READY), runnerMap(PI_READY), MODELS)
    await markPermissionsReviewed(storeWith(PI_READY))

    const later = await prepareFirstRun(storeWith(PI_READY), runnerMap(PI_READY), MODELS)

    expect(later.permissionsReviewed).toBe(true)
    expect((await readSetupRecord())?.permissionsReviewedAt).not.toBeNull()
  })

  test('a corrupt marker counts as reviewed, so a broken file never shows the card forever', async () => {
    await mkdir(home, { recursive: true })
    await writeFile(setupStatePath(), '{not json', 'utf8')

    const state = await prepareFirstRun(storeWith(PI_READY), runnerMap(PI_READY), MODELS)

    expect(state.permissionsReviewed).toBe(true)
  })
})
