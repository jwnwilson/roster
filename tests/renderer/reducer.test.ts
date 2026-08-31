import { beforeEach, describe, expect, test } from 'vitest'
import type { Approval, Message, Plan, PlanComment, Usage } from '@shared/types'
import { reducePlanEvent, reduceSessionEvent, useRoster } from '@/state/store'
import { aSession } from './factories'

const INITIAL = useRoster.getState()

beforeEach(() => {
  useRoster.setState(INITIAL, true)
})

function state() {
  return useRoster.getState()
}

function textMessage(id: string, text: string): Message {
  return {
    id,
    sessionId: 's1',
    kind: 'text',
    createdAt: 0,
    role: 'assistant',
    who: 'Agent',
    text,
  }
}

const USAGE: Usage = {
  sessionId: 's1',
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  costUsd: 0.5,
}

const APPROVAL: Approval = {
  id: 'a1',
  sessionId: 's1',
  toolName: 'Bash',
  command: 'git push --force',
  status: 'pending',
  createdAt: 0,
}

describe('reduceSessionEvent — messages', () => {
  test('appends a new message to its session', () => {
    const next = reduceSessionEvent(state(), {
      type: 'message',
      sessionId: 's1',
      message: textMessage('m1', 'hello'),
    })

    expect(next.messages?.['s1']).toHaveLength(1)
  })

  test('appends after existing messages rather than replacing them', () => {
    useRoster.setState({ messages: { s1: [textMessage('m1', 'first')] } })

    const next = reduceSessionEvent(state(), {
      type: 'message',
      sessionId: 's1',
      message: textMessage('m2', 'second'),
    })

    expect(next.messages?.['s1']?.map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  test('leaves other sessions untouched', () => {
    useRoster.setState({ messages: { other: [textMessage('x', 'x')] } })

    const next = reduceSessionEvent(state(), {
      type: 'message',
      sessionId: 's1',
      message: textMessage('m1', 'hello'),
    })

    expect(next.messages?.['other']).toHaveLength(1)
  })

  test('an update replaces the message in place, preserving order', () => {
    useRoster.setState({
      messages: { s1: [textMessage('m1', 'first'), textMessage('m2', 'second')] },
    })

    const next = reduceSessionEvent(state(), {
      type: 'message-updated',
      sessionId: 's1',
      message: textMessage('m1', 'edited'),
    })

    expect(next.messages?.['s1']?.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect((next.messages?.['s1']?.[0] as { text: string }).text).toBe('edited')
  })

  test('an update for an unseen message is appended rather than dropped', () => {
    // Can happen if the transcript was loaded after the turn began.
    const next = reduceSessionEvent(state(), {
      type: 'message-updated',
      sessionId: 's1',
      message: textMessage('m9', 'late'),
    })

    expect(next.messages?.['s1']).toHaveLength(1)
  })
})

describe('reduceSessionEvent — status', () => {
  test('updates the session inside its agent list', () => {
    useRoster.setState({
      sessions: { debugging: [aSession({ id: 's1', status: 'idle' })] },
    })

    const next = reduceSessionEvent(state(), {
      type: 'status',
      sessionId: 's1',
      status: 'approval',
    })

    expect(next.sessions?.['debugging']?.[0]?.status).toBe('approval')
  })

  test('leaves sessions belonging to other agents alone', () => {
    useRoster.setState({
      sessions: {
        debugging: [aSession({ id: 's1', status: 'idle' })],
        review: [aSession({ id: 's2', status: 'done' })],
      },
    })

    const next = reduceSessionEvent(state(), {
      type: 'status',
      sessionId: 's1',
      status: 'running',
    })

    expect(next.sessions?.['review']?.[0]?.status).toBe('done')
  })

  test('a status for an unknown session changes nothing', () => {
    useRoster.setState({ sessions: { debugging: [aSession({ id: 's1' })] } })

    const next = reduceSessionEvent(state(), {
      type: 'status',
      sessionId: 'ghost',
      status: 'error',
    })

    expect(next.sessions?.['debugging']?.[0]?.status).toBe('idle')
  })
})

describe('reduceSessionEvent — streaming and usage', () => {
  test('records that a turn is in flight', () => {
    const next = reduceSessionEvent(state(), {
      type: 'streaming',
      sessionId: 's1',
      active: true,
    })

    expect(next.streaming?.['s1']).toBe(true)
  })

  test('records when it finishes', () => {
    useRoster.setState({ streaming: { s1: true } })

    const next = reduceSessionEvent(state(), {
      type: 'streaming',
      sessionId: 's1',
      active: false,
    })

    expect(next.streaming?.['s1']).toBe(false)
  })

  test('stores usage against its session', () => {
    const next = reduceSessionEvent(state(), { type: 'usage', sessionId: 's1', usage: USAGE })

    expect(next.usage?.['s1']).toEqual(USAGE)
  })

  test('later usage replaces earlier, since runners report totals', () => {
    useRoster.setState({ usage: { s1: USAGE } })

    const next = reduceSessionEvent(state(), {
      type: 'usage',
      sessionId: 's1',
      usage: { ...USAGE, inputTokens: 999 },
    })

    expect(next.usage?.['s1']?.inputTokens).toBe(999)
  })
})

describe('reduceSessionEvent — approvals', () => {
  test('adds a pending approval', () => {
    const next = reduceSessionEvent(state(), {
      type: 'approval',
      sessionId: 's1',
      approval: APPROVAL,
    })

    expect(next.approvals?.['s1']).toEqual([APPROVAL])
  })

  test('queues a second approval behind the first', () => {
    useRoster.setState({ approvals: { s1: [APPROVAL] } })

    const next = reduceSessionEvent(state(), {
      type: 'approval',
      sessionId: 's1',
      approval: { ...APPROVAL, id: 'a2' },
    })

    expect(next.approvals?.['s1']).toHaveLength(2)
  })

  test('resolving removes just that approval', () => {
    useRoster.setState({ approvals: { s1: [APPROVAL, { ...APPROVAL, id: 'a2' }] } })

    const next = reduceSessionEvent(state(), {
      type: 'approval-resolved',
      sessionId: 's1',
      approvalId: 'a1',
    })

    expect(next.approvals?.['s1']?.map((a) => a.id)).toEqual(['a2'])
  })

  test('resolving one that is already gone changes nothing', () => {
    useRoster.setState({ approvals: { s1: [APPROVAL] } })

    const next = reduceSessionEvent(state(), {
      type: 'approval-resolved',
      sessionId: 's1',
      approvalId: 'gone',
    })

    expect(next.approvals?.['s1']).toHaveLength(1)
  })
})

describe('store actions', () => {
  test('setUsage and setMessages write through', () => {
    useRoster.getState().setUsage('s1', USAGE)
    useRoster.getState().setMessages('s1', [textMessage('m1', 'x')])

    expect(state().usage['s1']).toEqual(USAGE)
    expect(state().messages['s1']).toHaveLength(1)
  })

  test('setSkills and setMcpServers write through', () => {
    useRoster.getState().setSkills([])
    useRoster.getState().setMcpServers([])

    expect(state().skills).toEqual([])
    expect(state().mcpServers).toEqual([])
  })

  test('the New Agent form fields are independent of the edit draft', () => {
    useRoster.getState().setNewRunner('codex')
    useRoster.getState().setNewModel('gpt-5.6-luna')
    useRoster.getState().setNewPrompt('be brief')
    useRoster.getState().togglePicked('repro-harness')

    expect(state().newRunner).toBe('codex')
    expect(state().newModel).toBe('gpt-5.6-luna')
    expect(state().newPrompt).toBe('be brief')
    expect(state().picked['repro-harness']).toBe(true)
    expect(state().draft).toBeNull()
  })

  test('draft edits are ignored when no draft is open', () => {
    useRoster.getState().patchDraft({ model: 'x' })
    useRoster.getState().toggleDraftSkill('y')
    useRoster.getState().toggleDraftMcp('z')

    expect(state().draft).toBeNull()
  })

  test('selecting a session records it for that agent', () => {
    useRoster.getState().selectSession('debugging', 's9')
    expect(state().sess['debugging']).toBe('s9')
  })

  test('setMcpTab switches the MCP view', () => {
    useRoster.getState().setMcpTab('registry')
    expect(state().mcpTab).toBe('registry')
  })
})

describe('reduceSessionEvent — activity', () => {
  test('records what the agent is doing', () => {
    const next = reduceSessionEvent(state(), {
      type: 'activity',
      sessionId: 's1',
      text: 'Running pytest …',
    })

    expect(next.activity?.['s1']).toBe('Running pytest …')
  })

  test('later activity replaces earlier', () => {
    useRoster.setState({ activity: { s1: 'Thinking …' } })

    const next = reduceSessionEvent(state(), {
      type: 'activity',
      sessionId: 's1',
      text: 'Reading pool.ts …',
    })

    expect(next.activity?.['s1']).toBe('Reading pool.ts …')
  })

  test('a finished turn clears it, so no stale text lingers', () => {
    useRoster.setState({ activity: { s1: 'Running pytest …' } })

    const next = reduceSessionEvent(state(), {
      type: 'streaming',
      sessionId: 's1',
      active: false,
    })

    expect(next.activity?.['s1']).toBeUndefined()
  })

  test('a finished turn leaves other sessions alone', () => {
    useRoster.setState({ activity: { other: 'Reading …' } })

    const next = reduceSessionEvent(state(), {
      type: 'streaming',
      sessionId: 's1',
      active: false,
    })

    expect(next.activity?.['other']).toBe('Reading …')
  })
})

describe('reducePlanEvent', () => {
  const PLAN: Plan = {
    id: 'p1',
    sessionId: 's1',
    agentId: 'debugging',
    title: 'Archive projects',
    status: 'draft',
    version: 1,
    createdAt: 0,
    updatedAt: 0,
  }

  function aNote(id: string, text: string): PlanComment {
    return {
      id,
      planId: 'p1',
      author: 'You',
      tone: 'you',
      text,
      version: 1,
      createdAt: 0,
    }
  }

  function apply(event: Parameters<typeof reducePlanEvent>[1]): void {
    useRoster.setState((s) => reducePlanEvent(s, event))
  }

  test('a revision replaces the plan on an open document', () => {
    useRoster.setState({ plans: { p1: { plan: PLAN, body: '# v1' } } })

    apply({ type: 'plan-updated', plan: { ...PLAN, version: 2, status: 'draft' } })

    expect(state().plans['p1']?.plan.version).toBe(2)
  })

  test('the body is left alone, since only the store has the new one', () => {
    useRoster.setState({ plans: { p1: { plan: PLAN, body: '# v1' } } })

    apply({ type: 'plan-updated', plan: { ...PLAN, version: 2 } })

    // The modal re-reads it; guessing here would show v1 under a v2 heading.
    expect(state().plans['p1']?.body).toBe('# v1')
  })

  test('a plan nobody has open is ignored', () => {
    apply({ type: 'plan-updated', plan: PLAN })

    expect(state().plans['p1']).toBeUndefined()
  })

  test('a note appends to a thread that is open', () => {
    useRoster.setState({ planComments: { p1: [aNote('c1', 'first')] } })

    apply({ type: 'comment', planId: 'p1', comment: aNote('c2', 'second') })

    expect(state().planComments['p1']?.map((c) => c.text)).toEqual(['first', 'second'])
  })

  test('the same note twice appends once', () => {
    useRoster.setState({ planComments: { p1: [aNote('c1', 'first')] } })

    // It arrives from the call that wrote it and from the broadcast.
    apply({ type: 'comment', planId: 'p1', comment: aNote('c1', 'first') })

    expect(state().planComments['p1']).toHaveLength(1)
  })

  test('a note on a thread that was never opened is ignored', () => {
    apply({ type: 'comment', planId: 'p1', comment: aNote('c1', 'first') })

    // It will be read in full when the plan is opened.
    expect(state().planComments['p1']).toBeUndefined()
  })
})

describe('opening and closing a plan', () => {
  test('opening one names it', () => {
    useRoster.getState().openPlan('p1')

    expect(state().openPlanId).toBe('p1')
  })

  test('closing it lets go', () => {
    useRoster.getState().openPlan('p1')
    useRoster.getState().closePlan()

    expect(state().openPlanId).toBeNull()
  })

  test('a document read over IPC is kept for the modal', () => {
    const document = {
      plan: {
        id: 'p1',
        sessionId: 's1',
        agentId: 'debugging',
        title: 'Archive projects',
        status: 'draft' as const,
        version: 1,
        createdAt: 0,
        updatedAt: 0,
      },
      body: '# Archive projects',
    }

    useRoster.getState().setPlan(document)

    expect(state().plans['p1']).toEqual(document)
  })
})
