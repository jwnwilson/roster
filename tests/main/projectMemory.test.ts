import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Agent } from '@shared/types'
import type { TaskTools } from '@main/runners/taskTools'
import type { MemoryTools } from '@main/runners/memoryTools'

/**
 * What one session filed under a project knows about the rest of it.
 *
 * The spec's own acceptance check is here: two sessions on *different*
 * agents under one project, the first comments on a task, and the second
 * knows it without being told to look.
 */

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

const createRosterMcpServer = vi.fn().mockResolvedValue({ fake: 'roster' })
vi.mock('@main/runners/handoffTool', () => ({ createRosterMcpServer }))

/** Stubbed to get hold of the TaskTools the manager builds; see taskTools.test.ts. */
const createTasksMcpServer = vi.fn().mockResolvedValue({ fake: 'tasks' })
vi.mock('@main/runners/taskTools', () => ({ createTasksMcpServer }))

/** Stubbed for the same reason: it is how the MemoryTools are got hold of. */
const createMemoryMcpServer = vi.fn().mockResolvedValue({ fake: 'memory' })
vi.mock('@main/runners/memoryTools', () => ({ createMemoryMcpServer }))

const { openDatabase } = await import('@main/db')
const { SessionStore } = await import('@main/store/sessions')
const { UsageStore } = await import('@main/store/usage')
const { ProjectStore } = await import('@main/store/projects')
const { TaskStore } = await import('@main/store/tasks')
const { ClaudeRunner } = await import('@main/runners/claude')
const { ProjectNotesStore } = await import('@main/store/projectNotes')
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
    mcpServers: ['tasks', 'memory'],
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
    mcpServers: ['tasks', 'memory'],
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
    // Deliberately without the project's memory.
    mcpServers: ['tasks'],
    hidden: false,
    status: 'idle',
  },
]

let home: string
let sessions: InstanceType<typeof SessionStore>
let projects: InstanceType<typeof ProjectStore>
let tasks: InstanceType<typeof TaskStore>
let notes: InstanceType<typeof ProjectNotesStore>
let manager: InstanceType<typeof SessionManager>

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'roster-memory-'))
  process.env['ROSTER_HOME'] = home

  const db = openDatabase(':memory:')
  sessions = new SessionStore(db)
  projects = new ProjectStore(db)
  tasks = new TaskStore(db, (id) => AGENTS.find((a) => a.id === id)?.name ?? null)
  notes = new ProjectNotesStore(() => new Date(2026, 8, 5, 12, 0, 0))
  await notes.load()

  // Roster's own servers are only given to a Claude runner.
  Object.setPrototypeOf(runnerStub, ClaudeRunner.prototype)

  manager = new SessionManager(
    {
      findAll: () => AGENTS,
      findById: (id: string) => AGENTS.find((a) => a.id === id) ?? null,
    } as never,
    sessions,
    { findAll: () => [] } as never,
    { findAll: () => [] } as never,
    new UsageStore(db),
    { tasks, projects },
    undefined,
    notes,
  )

  createTasksMcpServer.mockClear()
  createMemoryMcpServer.mockClear()
  runnerStub.run.mockReset()
  runnerStub.run.mockImplementation(async function* () {
    yield { kind: 'done', runnerSessionId: 'r1' }
  })
})

afterEach(async () => {
  notes.dispose()
  delete process.env['ROSTER_HOME']
  await rm(home, { recursive: true, force: true })
})

/** The prompt the runner was handed on the most recent turn. */
function lastPrompt(): string {
  const call = runnerStub.run.mock.calls.at(-1)
  return (call?.[0] as string | undefined) ?? ''
}

/** The MemoryTools the manager built on the most recent turn. */
function lastMemoryTools(): MemoryTools {
  const call = createMemoryMcpServer.mock.calls.at(-1)
  const tools = call?.[0] as MemoryTools | undefined
  if (!tools) throw new Error('the manager passed no memory tools')
  return tools
}

/** The TaskTools the manager built on the most recent turn. */
function lastTaskTools(): TaskTools {
  const call = createTasksMcpServer.mock.calls.at(-1)
  const tools = call?.[0] as TaskTools | undefined
  if (!tools) throw new Error('the manager passed no task tools')
  return tools
}

describe('the project brief a filed session is sent with', () => {
  test('puts the project in front of the agent without being asked', async () => {
    const project = projects.create({
      name: 'API reliability',
      color: '#7c5cff',
      description: 'Retries and pool exhaustion under load.',
    })
    tasks.create({ title: 'Fix connection pool leak on 504', projectId: project.id })

    const session = manager.create('debugging', 'Work', project.id)
    await manager.send(session.id, 'what should I pick up?')

    const prompt = lastPrompt()
    expect(prompt).toContain('Project: API reliability')
    expect(prompt).toContain('Fix connection pool leak on 504')
    // The user's own words are still the last thing the agent reads.
    expect(prompt.endsWith('what should I pick up?')).toBe(true)
  })

  test('adds nothing at all to a session with no project', async () => {
    const session = manager.create('debugging', 'Work', null)
    await manager.send(session.id, 'just this')

    expect(lastPrompt()).toBe('just this')
  })

  test('is not written into the transcript', async () => {
    const project = projects.create({ name: 'API reliability', color: '#7c5cff' })
    tasks.create({ title: 'Fix connection pool leak on 504', projectId: project.id })

    const session = manager.create('debugging', 'Work', project.id)
    await manager.send(session.id, 'what should I pick up?')

    // Prompt context, not transcript: a wall of generated text in the chat
    // every turn is not what the user typed.
    const texts = sessions
      .messages(session.id)
      .filter((message) => message.kind === 'text' && message.role === 'user')
      .map((message) => (message.kind === 'text' ? message.text : ''))

    expect(texts).toEqual(['what should I pick up?'])
  })

  test('carries what one agent concluded to a different agent on the same project', async () => {
    const project = projects.create({ name: 'API reliability', color: '#7c5cff' })
    const task = tasks.create({ title: 'Fix connection pool leak on 504', projectId: project.id })

    // The Debugging Agent works, and leaves what it found on the task.
    const debugging = manager.create('debugging', 'Investigate', project.id)
    await manager.send(debugging.id, 'find the leak')
    lastTaskTools().comment(task.id, 'release() double-frees when the 504 handler retries.')

    // A different agent, a different session, and nobody tells it to look.
    const review = manager.create('review', 'Review', project.id)
    await manager.send(review.id, 'is this ready to ship?')

    expect(lastPrompt()).toContain(
      'Debugging Agent on ROS-1: release() double-frees when the 504 handler retries.',
    )
  })

  test('says nothing about a project that has no tasks and no notes', async () => {
    const project = projects.create({ name: 'Fresh', color: '#7c5cff' })
    const session = manager.create('debugging', 'Work', project.id)
    await manager.send(session.id, 'hello')

    const prompt = lastPrompt()
    expect(prompt).toContain('Project: Fresh')
    expect(prompt).not.toContain('Open tasks')
  })

  test('survives a project row that has gone', async () => {
    const project = projects.create({ name: 'Doomed', color: '#7c5cff' })
    const session = manager.create('debugging', 'Work', project.id)
    // Deleting a project detaches sessions, but a row read between the two
    // must not take the turn down with it.
    sessions.setProject(session.id, project.id)
    projects.delete(project.id)
    sessions.setProject(session.id, project.id)

    await manager.send(session.id, 'still here?')
    expect(lastPrompt()).toBe('still here?')
  })
})

describe('the memory server an agent may be given', () => {
  test('is offered to an agent that enabled it on a filed session', async () => {
    const project = projects.create({ name: 'API reliability', color: '#7c5cff' })
    const session = manager.create('debugging', 'Work', project.id)
    await manager.send(session.id, 'go')

    expect(createMemoryMcpServer).toHaveBeenCalled()
  })

  test('is withheld from an agent that has not enabled it', async () => {
    // Nothing changes for an agent nobody opted in: the board is still there,
    // the project's memory simply is not.
    const project = projects.create({ name: 'API reliability', color: '#7c5cff' })
    const session = manager.create('estimation', 'Work', project.id)
    await manager.send(session.id, 'go')

    expect(createMemoryMcpServer).not.toHaveBeenCalled()
    expect(createTasksMcpServer).toHaveBeenCalled()
  })

  test('is withheld from a session with no project, since there is nothing to recall', async () => {
    const session = manager.create('debugging', 'Work', null)
    await manager.send(session.id, 'go')

    expect(createMemoryMcpServer).not.toHaveBeenCalled()
  })

  test('is withheld from a manager that has no notes store', async () => {
    const db = openDatabase(':memory:')
    const bare = new SessionManager(
      {
        findAll: () => AGENTS,
        findById: (id: string) => AGENTS.find((a) => a.id === id) ?? null,
      } as never,
      new SessionStore(db),
      { findAll: () => [] } as never,
      { findAll: () => [] } as never,
      new UsageStore(db),
      { tasks, projects },
    )

    const project = projects.create({ name: 'API reliability', color: '#7c5cff' })
    const session = bare.create('debugging', 'Work', project.id)
    await bare.send(session.id, 'go')

    expect(createMemoryMcpServer).not.toHaveBeenCalled()
  })

  test('reads and writes only its own session’s project', async () => {
    const ours = projects.create({ name: 'Ours', color: '#7c5cff' })
    const theirs = projects.create({ name: 'Theirs', color: '#7c5cff' })
    await notes.append(theirs.id, { author: 'Someone', note: 'not for us' })

    const session = manager.create('debugging', 'Work', ours.id)
    await manager.send(session.id, 'go')

    const memory = lastMemoryTools()
    await memory.remember('ours alone')

    expect(memory.recall()).not.toContain('not for us')
    expect(notes.read(ours.id)).toContain('ours alone')
    expect(notes.read(theirs.id)).not.toContain('ours alone')
  })

  test('signs a remembered line with the agent that wrote it', async () => {
    const project = projects.create({ name: 'API reliability', color: '#7c5cff' })
    const session = manager.create('review', 'Work', project.id)
    await manager.send(session.id, 'go')

    await lastMemoryTools().remember('one pool per process')
    expect(notes.read(project.id)).toContain(
      '- 2026-09-05 Review Agent: one pool per process',
    )
  })
})

describe('notes and the brief', () => {
  test('reach the next agent on the project without it being told to look', async () => {
    const project = projects.create({ name: 'API reliability', color: '#7c5cff' })

    const debugging = manager.create('debugging', 'Investigate', project.id)
    await manager.send(debugging.id, 'find the leak')
    await lastMemoryTools().remember('the pool is not safe to share across forks')

    const review = manager.create('review', 'Review', project.id)
    await manager.send(review.id, 'is this ready to ship?')

    expect(lastPrompt()).toContain('the pool is not safe to share across forks')
  })

  test('reach an agent that cannot write them', async () => {
    // Reading the project is not the thing that is gated; adding to it is.
    const project = projects.create({ name: 'API reliability', color: '#7c5cff' })
    await notes.append(project.id, { author: 'Debugging Agent', note: 'a standing decision' })

    const session = manager.create('estimation', 'Estimate', project.id)
    await manager.send(session.id, 'how long?')

    expect(lastPrompt()).toContain('a standing decision')
  })

  test('do not spend the budget on the starter Roster wrote for the reader', async () => {
    const project = projects.create({ name: 'API reliability', color: '#7c5cff' })
    await notes.append(project.id, { author: 'Debugging Agent', note: 'a finding' })

    const session = manager.create('debugging', 'Work', project.id)
    await manager.send(session.id, 'go')

    const prompt = lastPrompt()
    expect(prompt).toContain('a finding')
    expect(prompt).not.toContain('Agents append dated lines here')
  })

  test('read as no notes at all when only the starter has been written', async () => {
    const project = projects.create({ name: 'API reliability', color: '#7c5cff' })
    const session = manager.create('debugging', 'Work', project.id)
    await manager.send(session.id, 'go')

    // A file created and then emptied of its one line is not a project with
    // notes, and recall should not read Roster's own words back as though it
    // were.
    await lastMemoryTools().remember('a finding')
    await notes.write(project.id, notes.read(project.id).replace(/^- .*$/m, ''))

    expect(lastMemoryTools().recall().trim()).toBe('')
  })

  test('are left out entirely when the file is empty', async () => {
    const project = projects.create({ name: 'API reliability', color: '#7c5cff' })
    await notes.write(project.id, '\n\n')

    const session = manager.create('debugging', 'Work', project.id)
    await manager.send(session.id, 'go')

    expect(lastPrompt()).not.toContain('Project notes')
  })
})
