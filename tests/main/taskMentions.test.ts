import { beforeEach, describe, expect, test, vi } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { SessionStore } from '@main/store/sessions'
import { TaskStore } from '@main/store/tasks'
import { TaskMentions } from '@main/sessions/mentions'
import type { Agent, TaskSessionLink } from '@shared/types'

function anAgent(id: string, name: string): Agent {
  return {
    id,
    name,
    runner: 'claude',
    model: 'claude-opus-5',
    cwd: '/work/api',
    cwdLabel: '~/work/api',
    systemPrompt: 'Reproduce before you fix.',
    skills: [],
    mcpServers: [],
    hidden: false,
    status: 'idle',
  }
}

const ROSTER = [anAgent('tech-lead', 'Tech Lead'), anAgent('debugging', 'Debugging Agent')]

let db: Db
let sessions: SessionStore
let tasks: TaskStore
let send: ReturnType<typeof vi.fn>
let attached: TaskSessionLink[]
let mentions: TaskMentions

beforeEach(() => {
  db = openDatabase(':memory:')
  sessions = new SessionStore(db)
  tasks = new TaskStore(db, (id) => ROSTER.find((a) => a.id === id)?.name ?? null)
  send = vi.fn().mockResolvedValue(undefined)
  attached = []
  mentions = new TaskMentions(
    () => ROSTER,
    sessions,
    tasks,
    { send: send as unknown as (s: string, p: string) => Promise<void> },
    (link) => attached.push(link),
  )
})

/** A task with a thread, as the handler would have left it. */
function aTask(title = 'Fix connection pool leak'): string {
  const task = tasks.create({ title, description: 'It leaks on 504.' })
  return task.id
}

describe('TaskMentions.dispatch — opening a session', () => {
  test('opens a session for the agent that was mentioned', async () => {
    const id = aTask()

    await mentions.dispatch(id, '@tech-lead what do you make of this?')

    const session = sessions.findByTask(id, 'tech-lead')
    expect(session).not.toBeNull()
    expect(session?.agentId).toBe('tech-lead')
  })

  test('titles the session after the task, so its tab says what it is', async () => {
    const id = aTask('Fix connection pool leak')

    await mentions.dispatch(id, '@tech-lead look at this')

    expect(sessions.findByTask(id, 'tech-lead')?.title).toBe(
      `${id} — Fix connection pool leak`,
    )
  })

  test('opens the transcript with the task, so the agent is not answering blind', async () => {
    const id = aTask()
    tasks.comment(id, { author: 'You', tone: 'you', text: 'seen twice today' })

    await mentions.dispatch(id, '@tech-lead what do you make of this?')

    const session = sessions.findByTask(id, 'tech-lead')
    const [first] = sessions.messages(session?.id ?? '')
    expect(first?.kind).toBe('spawn')
    const brief = first?.kind === 'spawn' ? first.text : ''
    expect(brief).toContain(id)
    expect(brief).toContain('Fix connection pool leak')
    expect(brief).toContain('It leaks on 504.')
    expect(brief).toContain('seen twice today')
  })

  test('starts the turn with the comment that mentioned it', async () => {
    const id = aTask()

    await mentions.dispatch(id, '@tech-lead what do you make of this?')

    const session = sessions.findByTask(id, 'tech-lead')
    expect(send).toHaveBeenCalledWith(
      session?.id,
      `On ${id}: @tech-lead what do you make of this?`,
    )
  })

  test('announces the attachment, so an open panel can show it', async () => {
    const id = aTask()

    await mentions.dispatch(id, '@tech-lead hello')

    expect(attached).toEqual([
      {
        taskId: id,
        agentId: 'tech-lead',
        sessionId: sessions.findByTask(id, 'tech-lead')?.id,
        createdAt: expect.any(Number),
      },
    ])
  })
})

describe('TaskMentions.dispatch — resuming a session', () => {
  test('mentioning the same agent again continues its session', async () => {
    const id = aTask()
    await mentions.dispatch(id, '@tech-lead first question')
    const first = sessions.findByTask(id, 'tech-lead')?.id

    await mentions.dispatch(id, '@tech-lead second question')

    expect(sessions.findByTask(id, 'tech-lead')?.id).toBe(first)
    expect(send).toHaveBeenLastCalledWith(first, `On ${id}: @tech-lead second question`)
  })

  test('does not open the transcript a second time', async () => {
    const id = aTask()
    await mentions.dispatch(id, '@tech-lead first question')
    await mentions.dispatch(id, '@tech-lead second question')

    const session = sessions.findByTask(id, 'tech-lead')
    const spawns = sessions
      .messages(session?.id ?? '')
      .filter((message) => message.kind === 'spawn')
    expect(spawns).toHaveLength(1)
  })

  test('announces the attachment only when one is made', async () => {
    const id = aTask()
    await mentions.dispatch(id, '@tech-lead first')
    await mentions.dispatch(id, '@tech-lead second')

    expect(attached).toHaveLength(1)
  })

  test('a second agent gets its own session, not the first one', async () => {
    const id = aTask()
    await mentions.dispatch(id, '@tech-lead have a look')

    await mentions.dispatch(id, '@debugging you too')

    const lead = sessions.findByTask(id, 'tech-lead')
    const debugging = sessions.findByTask(id, 'debugging')
    expect(debugging?.id).not.toBe(lead?.id)
    expect(sessions.linksForTask(id)).toHaveLength(2)
  })

  test('asks both agents named in one comment', async () => {
    const id = aTask()

    await mentions.dispatch(id, '@tech-lead and @debugging, thoughts?')

    expect(sessions.linksForTask(id)).toHaveLength(2)
    expect(send).toHaveBeenCalledTimes(2)
  })
})

describe('TaskMentions.dispatch — when it should do nothing', () => {
  test('a comment with no mention starts no turn', async () => {
    const id = aTask()

    await mentions.dispatch(id, 'just thinking out loud')

    expect(send).not.toHaveBeenCalled()
    expect(sessions.linksForTask(id)).toEqual([])
  })

  test('an id nobody has starts no turn', async () => {
    const id = aTask()

    await mentions.dispatch(id, '@nobody are you there')

    expect(send).not.toHaveBeenCalled()
  })

  test('a task that no longer exists starts no turn', async () => {
    await mentions.dispatch('ROS-404', '@tech-lead hello')

    expect(send).not.toHaveBeenCalled()
  })
})
