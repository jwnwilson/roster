import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Agent } from '@shared/types'
import type { TaskTools } from '@main/runners/taskTools'

const runnerStub = {
  id: 'claude',
  detect: vi.fn(),
  models: vi.fn().mockResolvedValue([]),
  run: vi.fn(),
  respondToApproval: vi.fn(),
}

vi.mock('@main/runners/registry', () => ({
  getRunner: () => runnerStub,
  registerCustomRunners: vi.fn(),
  warmUpRunners: vi.fn(),
  allRunners: () => [runnerStub],
  isBuiltinRunner: () => true,
}))

/**
 * The SDK's MCP factories need a runtime the tests do not have, so both are
 * stubbed — and the task stub is also how we get hold of the TaskTools the
 * manager builds, which is the thing actually worth testing.
 */
const createRosterMcpServer = vi.fn().mockResolvedValue({ fake: 'roster' })
vi.mock('@main/runners/handoffTool', () => ({ createRosterMcpServer }))

const createTasksMcpServer = vi.fn().mockResolvedValue({ fake: 'tasks' })
vi.mock('@main/runners/taskTools', () => ({ createTasksMcpServer }))

const { openDatabase } = await import('@main/db')
const { SessionStore } = await import('@main/store/sessions')
const { UsageStore } = await import('@main/store/usage')
const { ProjectStore } = await import('@main/store/projects')
const { TaskStore } = await import('@main/store/tasks')
const { ClaudeRunner } = await import('@main/runners/claude')
const { SessionManager } = await import('@main/sessions/manager')

const AGENTS: Agent[] = [
  {
    id: 'debugging',
    name: 'Debugging Agent',
    runner: 'claude',
    model: 'claude-opus-5',
    cwd: '/work/api',
    cwdLabel: '~/work/api',
    systemPrompt: '',
    skills: [],
    mcpServers: ['tasks'],
    hidden: false,
    status: 'idle',
  },
  {
    id: 'review',
    name: 'Review Agent',
    runner: 'claude',
    model: 'claude-sonnet-5',
    cwd: '/work/api',
    cwdLabel: '~/work/api',
    systemPrompt: '',
    skills: [],
    mcpServers: ['tasks'],
    hidden: false,
    status: 'idle',
  },
  {
    id: 'estimation',
    name: 'Estimation Agent',
    runner: 'claude',
    model: 'claude-haiku-4-5',
    cwd: '/work/api',
    cwdLabel: '~/work/api',
    systemPrompt: '',
    skills: [],
    // Deliberately without the board.
    mcpServers: [],
    hidden: false,
    status: 'idle',
  },
]

let home: string
let tasks: InstanceType<typeof TaskStore>
let projects: InstanceType<typeof ProjectStore>
let manager: InstanceType<typeof SessionManager>

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'roster-tasktools-'))
  process.env['ROSTER_HOME'] = home

  const db = openDatabase(':memory:')
  const sessions = new SessionStore(db)
  projects = new ProjectStore(db)
  tasks = new TaskStore(db, (id) => AGENTS.find((a) => a.id === id)?.name ?? null)

  // The manager only hands the tools to a Claude runner, so the stub must
  // pass that instanceof check.
  Object.setPrototypeOf(runnerStub, ClaudeRunner.prototype)

  manager = new SessionManager(
    { findAll: () => AGENTS, findById: (id: string) => AGENTS.find((a) => a.id === id) ?? null } as never,
    sessions,
    { findAll: () => [] } as never,
    { findAll: () => [] } as never,
    new UsageStore(db),
    { tasks, projects },
  )

  createRosterMcpServer.mockClear()
  createTasksMcpServer.mockClear()
  runnerStub.run.mockReset()
  runnerStub.run.mockImplementation(async function* () {
    yield { kind: 'done', runnerSessionId: 'r1' }
  })
})

afterEach(async () => {
  delete process.env['ROSTER_HOME']
  await rm(home, { recursive: true, force: true })
})

/** Runs a turn and returns the TaskTools the manager handed the runner. */
async function taskTools(): Promise<TaskTools> {
  const session = manager.create('debugging', 'Work')
  await manager.send(session.id, 'go')

  const call = createTasksMcpServer.mock.calls[0]
  const tools = call?.[0] as TaskTools | undefined
  if (!tools) throw new Error('the manager passed no task tools')
  return tools
}

describe('the task tools an agent is given', () => {
  test('are handed to the runner alongside the handoff tools', async () => {
    const tools = await taskTools()
    expect(typeof tools.list).toBe('function')
  })

  test('are absent when the manager has no board', async () => {
    const db = openDatabase(':memory:')
    const bare = new SessionManager(
      { findAll: () => AGENTS, findById: (id: string) => AGENTS.find((a) => a.id === id) ?? null } as never,
      new SessionStore(db),
      { findAll: () => [] } as never,
      { findAll: () => [] } as never,
      new UsageStore(db),
    )

    const session = bare.create('debugging', 'Work')
    await bare.send(session.id, 'go')

    expect(createTasksMcpServer).not.toHaveBeenCalled()
  })

  test('are absent when the agent has not enabled the tasks server', async () => {
    // The board exists and the agent runs on Claude; it simply was not given
    // the server, so there are no task tools to refuse it.
    const session = manager.create('estimation', 'Work')
    await manager.send(session.id, 'go')

    expect(createTasksMcpServer).not.toHaveBeenCalled()
    // Handoff is not gated, so that server is still built.
    expect(createRosterMcpServer).toHaveBeenCalled()
  })

  test('list the board', async () => {
    tasks.create({ title: 'One' })
    tasks.create({ title: 'Two' })

    expect((await taskTools()).list()).toHaveLength(2)
  })

  test('read a task and its thread', async () => {
    const task = tasks.create({ title: 'One' })
    tasks.comment(task.id, { author: 'you', tone: 'you', text: 'a note' })
    const tools = await taskTools()

    expect(tools.find(task.id)?.title).toBe('One')
    expect(tools.comments(task.id).map((entry) => entry.text)).toEqual(['a note'])
  })

  test('return nothing for a task that does not exist', async () => {
    expect((await taskTools()).find('ROS-404')).toBeNull()
  })

  test('resolve agent and project ids to names for display', async () => {
    const project = projects.create({ name: 'API reliability', color: 'a' })
    const tools = await taskTools()

    expect(tools.agentName('review')).toBe('Review Agent')
    expect(tools.agentName('ghost')).toBeNull()
    expect(tools.projectName(project.id)).toBe('API reliability')
    expect(tools.projectName('nope')).toBeNull()
  })

  test('say which projects are archived, so work cannot vanish into one', async () => {
    const live = projects.create({ name: 'API reliability', color: 'a' })
    const shipped = projects.create({ name: 'Shipped', color: 'b' })
    projects.setArchived(shipped.id, true)
    const tools = await taskTools()

    expect(tools.isArchivedProject(shipped.id)).toBe(true)
    expect(tools.isArchivedProject(live.id)).toBe(false)
    // An id nobody recognises is not an archived project; create_task
    // rejects it on its own terms.
    expect(tools.isArchivedProject('nope')).toBe(false)
  })

  test('an archived project still resolves to its name', async () => {
    const shipped = projects.create({ name: 'Shipped', color: 'b' })
    projects.setArchived(shipped.id, true)

    // Old tasks filed under it must keep naming it, or they read as unfiled.
    expect((await taskTools()).projectName(shipped.id)).toBe('Shipped')
  })
})

describe('an agent changing a task', () => {
  function history(taskId: string): string[] {
    return tasks
      .comments(taskId)
      .filter((c) => c.isSystem)
      .map((c) => c.text)
  }

  test('logs the move against the agent, not against you', async () => {
    const task = tasks.create({ title: 'One' })
    const tools = await taskTools()

    tools.update(task.id, { status: 'in_review' })

    expect(history(task.id)).toEqual(['Debugging Agent moved this to In Review.'])
  })

  test('picking a task up assigns it and starts it', async () => {
    const task = tasks.create({ title: 'One', status: 'todo' })
    const tools = await taskTools()

    const updated = tools.update(task.id, { assignee: 'debugging' })

    expect(updated.assigneeId).toBe('debugging')
    expect(updated.status).toBe('in_progress')
    expect(history(task.id)).toEqual(['Debugging Agent picked up this task.'])
  })

  test('several fields at once get a History line each', async () => {
    const task = tasks.create({ title: 'One' })
    const tools = await taskTools()

    tools.update(task.id, { status: 'done', priority: 'urgent', addLabel: 'bug' })

    // One line standing for three changes would lose which was which.
    expect(history(task.id)).toEqual([
      'Debugging Agent moved this to Done.',
      'Changed priority to Urgent.',
      'Added label bug.',
    ])
  })

  test('returns the task as it now stands', async () => {
    const task = tasks.create({ title: 'One', labels: ['old'] })
    const tools = await taskTools()

    const updated = tools.update(task.id, { removeLabel: 'old', addLabel: 'new' })

    expect(updated.labels).toEqual(['new'])
  })

  test('a patch that changes nothing still returns the task', async () => {
    const task = tasks.create({ title: 'One' })
    const tools = await taskTools()

    expect(tools.update(task.id, {}).id).toBe(task.id)
    expect(history(task.id)).toEqual([])
  })

  test('refuses a task that does not exist', async () => {
    const tools = await taskTools()

    expect(() => tools.update('ROS-404', { status: 'done' })).toThrow('unknown task "ROS-404"')
  })

  test('comments in its own name', async () => {
    const task = tasks.create({ title: 'One' })
    const tools = await taskTools()

    tools.comment(task.id, 'Reproduced it — patch on fix/leak.')

    const posted = tasks.comments(task.id).find((c) => !c.isSystem)
    expect(posted).toMatchObject({
      author: 'Debugging Agent',
      tone: 'agent',
      text: 'Reproduced it — patch on fix/leak.',
    })
  })

  test('creates a task on the board', async () => {
    const tools = await taskTools()

    const created = tools.create({
      title: 'Add a regression test',
      description: 'Cover the 504 path.',
      priority: 'high',
      projectId: null,
    })

    expect(tasks.findById(created.id)).toMatchObject({
      title: 'Add a regression test',
      priority: 'high',
      status: 'todo',
    })
  })

  test('its change reaches the board the same way a drag would', async () => {
    const task = tasks.create({ title: 'One' })
    const seen: string[] = []
    tasks.subscribe((event) => seen.push(event.type))
    const tools = await taskTools()

    tools.update(task.id, { status: 'done' })

    expect(seen).toContain('task-updated')
  })
})
