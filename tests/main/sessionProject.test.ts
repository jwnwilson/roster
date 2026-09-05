import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Agent } from '@shared/types'

/**
 * The registry and the roster MCP server are stubbed for the same reason as
 * in sessionManager.test.ts: opening a session must not need a real CLI.
 */
vi.mock('@main/runners/registry', () => ({
  getRunner: () => null,
  registerCustomRunners: vi.fn(),
  warmUpRunners: vi.fn(),
  allRunners: () => [],
  isBuiltinRunner: () => true,
}))

vi.mock('@main/runners/handoffTool', () => ({
  createRosterMcpServer: vi.fn().mockResolvedValue({ fake: 'mcp' }),
}))

const { openDatabase } = await import('@main/db')
const { SessionStore } = await import('@main/store/sessions')
const { ProjectStore } = await import('@main/store/projects')
const { TaskStore } = await import('@main/store/tasks')
const { UsageStore } = await import('@main/store/usage')
const { SessionManager } = await import('@main/sessions/manager')
const { resolveSessionProject } = await import('@main/sessions/defaultProject')

function anAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'debugging',
    name: 'Debugging Agent',
    runner: 'claude',
    model: 'claude-opus-5',
    cwd: '/work/api',
    cwdLabel: '~/work/api',
    systemPrompt: '',
    skills: [],
    mcpServers: [],
    hidden: false,
    defaultProjectId: null,
    status: 'idle',
    ...overrides,
  }
}

const ACTIVE = {
  id: 'proj-reliability',
  name: 'API reliability',
  color: 'var(--color-project-4)',
  description: '',
  createdAt: 1,
  archivedAt: null,
}

const ARCHIVED = { ...ACTIVE, id: 'proj-old', archivedAt: 2 }

const lookup = {
  findById: (id: string) => [ACTIVE, ARCHIVED].find((p) => p.id === id) ?? null,
}

describe('resolveSessionProject', () => {
  test('files the session under the agent default', () => {
    const agent = anAgent({ defaultProjectId: ACTIVE.id })
    expect(resolveSessionProject({ agent, projects: lookup })).toBe(ACTIVE.id)
  })

  test('files it under nothing when the agent has no default', () => {
    expect(resolveSessionProject({ agent: anAgent(), projects: lookup })).toBeNull()
  })

  test('an explicit project wins over the default', () => {
    const agent = anAgent({ defaultProjectId: ACTIVE.id })
    expect(resolveSessionProject({ explicit: 'proj-other', agent, projects: lookup })).toBe(
      'proj-other',
    )
  })

  test('an explicit "no project" wins over the default too', () => {
    const agent = anAgent({ defaultProjectId: ACTIVE.id })
    expect(resolveSessionProject({ explicit: null, agent, projects: lookup })).toBeNull()
  })

  test('ignores a default naming a project that no longer exists', () => {
    const agent = anAgent({ defaultProjectId: 'proj-deleted' })
    expect(resolveSessionProject({ agent, projects: lookup })).toBeNull()
  })

  test('ignores an archived default, whose work is off the board anyway', () => {
    const agent = anAgent({ defaultProjectId: ARCHIVED.id })
    expect(resolveSessionProject({ agent, projects: lookup })).toBeNull()
  })

  test('ignores the default when there is nothing to check it against', () => {
    const agent = anAgent({ defaultProjectId: ACTIVE.id })
    expect(resolveSessionProject({ agent })).toBeNull()
  })

  test('files nothing for an agent that could not be read', () => {
    expect(resolveSessionProject({ agent: null, projects: lookup })).toBeNull()
  })
})

describe('SessionManager.create — the agent default', () => {
  let sessions: InstanceType<typeof SessionStore>
  let projects: InstanceType<typeof ProjectStore>
  let manager: InstanceType<typeof SessionManager>
  let agents: Agent[]

  beforeEach(() => {
    process.env['ROSTER_HOME'] = '/tmp/roster-session-project'
    const db = openDatabase(':memory:')
    sessions = new SessionStore(db)
    projects = new ProjectStore(db)
    const tasks = new TaskStore(db, () => null)
    agents = [anAgent()]

    manager = new SessionManager(
      {
        findAll: () => agents,
        findById: (id: string) => agents.find((a) => a.id === id) ?? null,
      } as never,
      sessions,
      { findAll: () => [] } as never,
      { findAll: () => [] } as never,
      new UsageStore(db),
      { tasks, projects },
    )
  })

  afterEach(() => {
    delete process.env['ROSTER_HOME']
  })

  test('links a new session to the default, so it needs no filing by hand', () => {
    const project = projects.create({ name: 'API reliability', color: 'c' })
    agents = [anAgent({ defaultProjectId: project.id })]

    const session = manager.create('debugging', 'Leak on 504')

    expect(session.projectId).toBe(project.id)
    expect(sessions.findById(session.id)?.projectId).toBe(project.id)
  })

  test('leaves a session unfiled when the agent has no default', () => {
    expect(manager.create('debugging', 'Leak').projectId).toBeNull()
  })

  test('lets an explicitly chosen project win', () => {
    const preferred = projects.create({ name: 'Preferred', color: 'c' })
    const fallback = projects.create({ name: 'Fallback', color: 'c' })
    agents = [anAgent({ defaultProjectId: fallback.id })]

    expect(manager.create('debugging', 'Leak', preferred.id).projectId).toBe(preferred.id)
  })

  test('lets an explicit "no project" win over the default', () => {
    const fallback = projects.create({ name: 'Fallback', color: 'c' })
    agents = [anAgent({ defaultProjectId: fallback.id })]

    expect(manager.create('debugging', 'Leak', null).projectId).toBeNull()
  })

  test('opens the session anyway when the default was deleted', () => {
    const gone = projects.create({ name: 'Gone', color: 'c' })
    agents = [anAgent({ defaultProjectId: gone.id })]
    projects.delete(gone.id)

    const session = manager.create('debugging', 'Leak')

    expect(session.projectId).toBeNull()
    expect(session.title).toBe('Leak')
  })

  test('a handed-off session lands in the receiving agent default too', () => {
    const project = projects.create({ name: 'API reliability', color: 'c' })
    agents = [anAgent(), anAgent({ id: 'review', name: 'Review Agent', defaultProjectId: project.id })]
    const from = manager.create('debugging', 'Leak')

    const { session } = manager.handOff({
      fromAgentId: 'debugging',
      fromSessionId: from.id,
      toAgentId: 'review',
      title: 'Check the fix',
      brief: 'Review the pool change.',
    })

    expect(session.projectId).toBe(project.id)
  })

  test('opens the session unfiled when the default was archived', () => {
    const shelved = projects.create({ name: 'Shelved', color: 'c' })
    agents = [anAgent({ defaultProjectId: shelved.id })]
    projects.setArchived(shelved.id, true)

    expect(manager.create('debugging', 'Leak').projectId).toBeNull()
  })
})
