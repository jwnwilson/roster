import { beforeEach, describe, expect, test, vi } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { SessionStore } from '@main/store/sessions'
import { TaskStore } from '@main/store/tasks'
import { TaskMentions, briefFor } from '@main/sessions/mentions'
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

describe('TaskMentions.briefFor', () => {
  test('leaves History lines out of the briefing', async () => {
    const id = aTask()
    // Create an ordinary comment
    tasks.comment(id, { author: 'You', tone: 'you', text: 'seen twice today' })
    // Apply a change which creates a History line
    tasks.apply(id, { field: 'status', value: 'in_progress' }, { name: 'You', tone: 'you' })

    // Get the thread and extract the brief
    const thread = tasks.comments(id)
    const brief = briefFor(tasks.findById(id)!, thread)

    // The brief should contain the ordinary comment
    expect(brief).toContain('seen twice today')
    // But not the History line (which is "You moved this to In Progress.")
    expect(brief).not.toContain('moved this to')
  })
})

/** What people actually wrote, in order — History is a different tab. */
function written(taskId: string): { author: string; text: string }[] {
  return tasks
    .comments(taskId)
    .filter((entry) => !entry.isSystem)
    .map((entry) => ({ author: entry.author, text: entry.text }))
}

/** Drives a turn that records prose, the way a real run would. */
function replyWith(...chunks: string[]): void {
  send.mockImplementation(async (sessionId: string) => {
    for (const text of chunks) {
      sessions.append({
        sessionId,
        kind: 'text',
        role: 'assistant',
        who: 'Tech Lead',
        text,
      })
    }
  })
}

describe('TaskMentions.dispatch — the answer', () => {
  test('posts the agent\'s reply into the thread', async () => {
    const id = aTask()
    replyWith('It is the retry path holding the connection.')

    await mentions.dispatch(id, '@tech-lead what do you make of this?')

    expect(written(id)).toContainEqual({
      author: 'Tech Lead',
      text: 'It is the retry path holding the connection.',
    })
  })

  test('joins the whole turn, not just its last paragraph', async () => {
    const id = aTask()
    // A turn flushes buffered prose in chunks, so one answer is routinely
    // several messages.
    replyWith('First, the retry path.', 'Second, the pool is never drained.')

    await mentions.dispatch(id, '@tech-lead why?')

    expect(written(id)).toContainEqual({
      author: 'Tech Lead',
      text: 'First, the retry path.\n\nSecond, the pool is never drained.',
    })
  })

  test('quotes only this turn, not the answer to the last question', async () => {
    const id = aTask()
    replyWith('An answer about the pool.')
    await mentions.dispatch(id, '@tech-lead first question')

    replyWith('An answer about the retries.')
    await mentions.dispatch(id, '@tech-lead second question')

    const answers = written(id).filter((entry) => entry.author === 'Tech Lead')
    expect(answers).toEqual([
      { author: 'Tech Lead', text: 'An answer about the pool.' },
      { author: 'Tech Lead', text: 'An answer about the retries.' },
    ])
  })

  test('ignores tool calls, which are not an answer', async () => {
    const id = aTask()
    send.mockImplementation(async (sessionId: string) => {
      sessions.append({
        sessionId,
        kind: 'tool',
        tool: 'Read',
        args: 'pool.ts',
        output: '…',
        isError: false,
      })
      sessions.append({
        sessionId,
        kind: 'text',
        role: 'assistant',
        who: 'Tech Lead',
        text: 'The retry path.',
      })
    })

    await mentions.dispatch(id, '@tech-lead why?')

    expect(written(id)).toContainEqual({ author: 'Tech Lead', text: 'The retry path.' })
  })

  test('says so in the thread when the turn produced no prose', async () => {
    const id = aTask()
    send.mockResolvedValue(undefined)

    await mentions.dispatch(id, '@tech-lead why?')

    // A mention must never silently produce nothing.
    const answers = written(id).filter((entry) => entry.author === 'Tech Lead')
    expect(answers).toHaveLength(1)
    expect(answers[0]?.text).toContain('nothing to quote')
  })
})

describe('TaskMentions.dispatch — when the turn fails', () => {
  test('reports the reason in the thread', async () => {
    const id = aTask()
    send.mockRejectedValue(new Error('no runner is registered for "claude"'))

    await mentions.dispatch(id, '@tech-lead why?')

    expect(written(id)).toContainEqual({
      author: 'Tech Lead',
      text: 'Couldn\'t answer — no runner is registered for "claude"',
    })
  })

  test('says plainly when the agent is simply busy', async () => {
    const id = aTask()
    send.mockRejectedValue(new Error('this session is already running'))

    await mentions.dispatch(id, '@tech-lead and another thing')

    // Raw, that message reads like a Roster bug rather than an agent that
    // has not finished the last question.
    expect(written(id)).toContainEqual({
      author: 'Tech Lead',
      text: 'Tech Lead is still working on your last question.',
    })
  })

  test('one agent failing does not stop the other from answering', async () => {
    const id = aTask()
    send.mockImplementation(async (sessionId: string) => {
      const session = sessions.findById(sessionId)
      if (session?.agentId === 'tech-lead') throw new Error('boom')
      sessions.append({
        sessionId,
        kind: 'text',
        role: 'assistant',
        who: 'Debugging Agent',
        text: 'I had a look.',
      })
    })

    await mentions.dispatch(id, '@tech-lead @debugging thoughts?')

    expect(written(id)).toContainEqual({
      author: 'Debugging Agent',
      text: 'I had a look.',
    })
    expect(written(id)).toContainEqual({
      author: 'Tech Lead',
      text: 'Couldn\'t answer — boom',
    })
  })
})
