import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AgentDetail } from '@/screens/AgentDetail'
import { useRoster } from '@/state/store'
import type { Session } from '@shared/types'
import { anAgent, aProject, aSession, aTask } from './factories'
import { installRosterApi } from './rosterApi'

// xterm needs a real canvas and devicePixelRatio, which jsdom does not
// provide. The terminal pane is verified against a live shell in the built
// app instead; here it only needs to be something AgentDetail can render.
vi.mock('@/terminal/TerminalPane', () => ({
  TerminalPane: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="terminal-pane">terminal for {sessionId}</div>
  ),
}))

/**
 * AgentDetail refetches its sessions on mount, so the bridge stub has to
 * serve them or the effect overwrites whatever the test seeded.
 */
function withSessions(sessions: Session[]): void {
  installRosterApi({ sessions: { listByAgent: vi.fn().mockResolvedValue(sessions) } })
  useRoster.setState({
    sessions: { debugging: sessions },
    ...(sessions[0] ? { sess: { debugging: sessions[0].id } } : {}),
  })
}

const INITIAL = useRoster.getState()

const AGENT = anAgent({ id: 'debugging', name: 'Debugging Agent' })

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  installRosterApi()
  useRoster.setState({ agents: [AGENT], agentId: 'debugging', loaded: true })
})

describe('AgentDetail — chrome', () => {
  test('shows the breadcrumb, agent name, and model', async () => {
    render(<AgentDetail />)

    expect(screen.getByRole('button', { name: 'Agents' })).toBeInTheDocument()
    expect(await screen.findByText('Debugging Agent')).toBeInTheDocument()
    // Shown twice by design: the breadcrumb and the config rail's Model row.
    expect(screen.getAllByText('claude-opus-5')).toHaveLength(2)
  })

  test('offers a way back when the agent is gone from disk', async () => {
    useRoster.setState({ agentId: 'deleted' })
    render(<AgentDetail />)

    expect(screen.getByText(/no longer on disk/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to agents' }))
    expect(useRoster.getState().screen).toBe('grid')
  })

  test('switches between the chat and terminal panes', async () => {
    const user = userEvent.setup()
    withSessions([aSession({ id: 's1' })])
    render(<AgentDetail />)

    await user.click(screen.getByRole('tab', { name: 'Terminal' }))
    expect(useRoster.getState().mode).toBe('terminal')

    await user.click(screen.getByRole('tab', { name: 'Chat' }))
    expect(useRoster.getState().mode).toBe('chat')
  })
})

describe('AgentDetail — sessions', () => {
  test('prompts to create one when the agent has none', async () => {
    render(<AgentDetail />)
    expect(await screen.findByText('No sessions on this agent yet.')).toBeInTheDocument()
  })

  test('marks the active session tab', async () => {
    withSessions([aSession({ id: 's1', title: 'First' }), aSession({ id: 's2', title: 'Second' })])
    useRoster.setState({ sess: { debugging: 's2' } })
    render(<AgentDetail />)

    const active = await screen.findByRole('button', { name: /^Second/ })
    expect(active).toHaveAttribute('aria-current', 'true')
  })

  test('switching tabs changes the selected session', async () => {
    const user = userEvent.setup()
    withSessions([aSession({ id: 's1', title: 'First' }), aSession({ id: 's2', title: 'Second' })])
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: /^Second/ }))
    expect(useRoster.getState().sess['debugging']).toBe('s2')
  })

  test('shows the origin of an agent-opened session', async () => {
    withSessions([aSession({ id: 's1', origin: 'agent', from: 'Architect Agent' })])
    render(<AgentDetail />)

    const tab = await screen.findByRole('button', { name: /^Session leak/ })
    expect(within(tab).getByText('↳')).toBeInTheDocument()
    expect(within(tab).getByText('Architect Agent')).toBeInTheDocument()
  })
})

describe('AgentDetail — approval banner', () => {
  const APPROVAL = {
    id: 'a1',
    sessionId: 's1',
    toolName: 'Bash',
    command: 'git push --force origin fix/session-leak',
    status: 'pending' as const,
    createdAt: 0,
  }

  beforeEach(() => {
    withSessions([aSession({ id: 's1', status: 'approval' })])
    useRoster.setState({ approvals: { s1: [APPROVAL] } })
  })

  test('names the exact command awaiting approval', async () => {
    render(<AgentDetail />)

    expect(await screen.findByText(/Waiting on you/)).toBeInTheDocument()
    expect(screen.getByText('git push --force origin fix/session-leak')).toBeInTheDocument()
  })

  test('Approve answers the runner affirmatively', async () => {
    const user = userEvent.setup()
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Approve' }))

    expect(window.roster.sessions.respondToApproval).toHaveBeenCalledWith('s1', 'a1', true)
  })

  test('Deny answers negatively', async () => {
    const user = userEvent.setup()
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Deny' }))

    expect(window.roster.sessions.respondToApproval).toHaveBeenCalledWith('s1', 'a1', false)
  })

  test('no banner when nothing is pending', async () => {
    useRoster.setState({ approvals: {} })
    render(<AgentDetail />)

    await waitFor(() => expect(screen.queryByText(/Waiting on you/)).not.toBeInTheDocument())
  })
})

describe('AgentDetail — answering a question', () => {
  const ASKING = {
    id: 'a1',
    sessionId: 's1',
    toolName: 'AskUserQuestion',
    command: 'Which cache backend?',
    questions: [
      {
        question: 'Which cache backend?',
        header: 'Cache',
        multiSelect: false,
        options: [
          { label: 'Redis', description: 'Distributed' },
          { label: 'None', description: 'Skip it' },
        ],
      },
    ],
    status: 'pending' as const,
    createdAt: 0,
  }

  beforeEach(() => {
    withSessions([aSession({ id: 's1', status: 'approval' })])
    useRoster.setState({ approvals: { s1: [ASKING] } })
  })

  test('the options are in the transcript, not the banner', async () => {
    render(<AgentDetail />)

    expect(await screen.findByRole('button', { name: /Redis/ })).toBeInTheDocument()
    // Approve/Deny is the wrong shape for a question — approving without an
    // answer only tells the agent nobody replied.
    expect(screen.queryByText(/Waiting on you/)).not.toBeInTheDocument()
  })

  test('a question still waiting is found again after a reload', async () => {
    // The store is empty on a fresh window, but the agent is still blocked
    // on the question. Nothing used to ask the main process for it, so the
    // turn simply looked dead.
    useRoster.setState({ approvals: {} })
    installRosterApi({
      sessions: {
        listByAgent: vi.fn().mockResolvedValue([aSession({ id: 's1', status: 'approval' })]),
        pendingApprovals: vi.fn().mockResolvedValue([ASKING]),
      },
    })

    render(<AgentDetail />)

    expect(await screen.findByRole('button', { name: /Redis/ })).toBeInTheDocument()
  })

  test('a question waiting behind another approval is still asked', async () => {
    const command = {
      id: 'a0',
      sessionId: 's1',
      toolName: 'Bash',
      command: 'git push',
      status: 'pending' as const,
      createdAt: 0,
    }
    useRoster.setState({ approvals: { s1: [command, ASKING] } })

    render(<AgentDetail />)

    // Only approvals[0] used to be read, so a question queued behind a
    // command was never put to the user at all.
    expect(await screen.findByRole('button', { name: /Redis/ })).toBeInTheDocument()
    expect(screen.getByText(/Waiting on you/)).toBeInTheDocument()
  })

  test('the banner answers the command, not the question', async () => {
    const command = {
      id: 'a0',
      sessionId: 's1',
      toolName: 'Bash',
      command: 'git push',
      status: 'pending' as const,
      createdAt: 0,
    }
    useRoster.setState({ approvals: { s1: [command, ASKING] } })
    const user = userEvent.setup()
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Approve' }))

    expect(window.roster.sessions.respondToApproval).toHaveBeenCalledWith('s1', 'a0', true)
  })

  test('clicking an option answers the pending approval', async () => {
    const user = userEvent.setup()
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: /Redis/ }))

    expect(window.roster.sessions.respondToApproval).toHaveBeenCalledWith('s1', 'a1', true, {
      'Which cache backend?': 'Redis',
    })
  })

  test('Skip allows the call with nothing filled in', async () => {
    const user = userEvent.setup()
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Skip' }))

    expect(window.roster.sessions.respondToApproval).toHaveBeenCalledWith('s1', 'a1', true, {})
  })

  test('an approval with no questions still uses the banner', async () => {
    useRoster.setState({
      approvals: { s1: [{ ...ASKING, toolName: 'Bash', command: 'git push', questions: undefined }] },
    })
    render(<AgentDetail />)

    expect(await screen.findByText(/Waiting on you/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Redis/ })).not.toBeInTheDocument()
  })
})

describe('AgentDetail — approving a plan', () => {
  const PLAN = {
    id: 'a1',
    sessionId: 's1',
    toolName: 'ExitPlanMode',
    command: '## Fix the connection pool leak',
    status: 'pending' as const,
    createdAt: 0,
  }

  beforeEach(() => {
    withSessions([aSession({ id: 's1', status: 'approval' })])
    useRoster.setState({ approvals: { s1: [PLAN] }, planMode: { s1: true } })
  })

  test('reads as a plan rather than as a command to run', async () => {
    render(<AgentDetail />)

    expect(await screen.findByText(/agent has a plan/)).toBeInTheDocument()
    expect(screen.getByText('## Fix the connection pool leak')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start work' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep planning' })).toBeInTheDocument()
  })

  test('starting work takes the session out of plan mode', async () => {
    const user = userEvent.setup()
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Start work' }))

    // Otherwise the next turn would still refuse to edit, and the agent would
    // re-plan the work it was just told to start.
    expect(window.roster.sessions.respondToApproval).toHaveBeenCalledWith('s1', 'a1', true)
    expect(useRoster.getState().planMode['s1']).toBe(false)
  })

  test('keeping planning leaves plan mode on', async () => {
    const user = userEvent.setup()
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Keep planning' }))

    expect(window.roster.sessions.respondToApproval).toHaveBeenCalledWith('s1', 'a1', false)
    expect(useRoster.getState().planMode['s1']).toBe(true)
  })

  test('offers to read the plan properly when there is one to read', async () => {
    useRoster.setState({ approvals: { s1: [{ ...PLAN, planId: 'plan-1' }] } })
    const user = userEvent.setup()
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Review plan' }))

    expect(useRoster.getState().openPlanId).toBe('plan-1')
  })

  test('answering a plan it never captured is unchanged', async () => {
    render(<AgentDetail />)

    // A plan from before this feature, or from a runner that has no plan
    // mode: the old two-button banner is still the whole of it.
    expect(await screen.findByRole('button', { name: 'Start work' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review plan' })).not.toBeInTheDocument()
  })

  test('mounts the plan modal once one is open', async () => {
    installRosterApi({
      plans: {
        read: vi.fn().mockResolvedValue({
          plan: {
            id: 'plan-1',
            sessionId: 's1',
            agentId: 'debugging',
            title: 'Fix the pool leak',
            status: 'draft',
            version: 1,
            createdAt: 0,
            updatedAt: 0,
          },
          body: '## Steps\n\n- reproduce\n',
        }),
        comments: vi.fn().mockResolvedValue([]),
      },
      sessions: { listByAgent: vi.fn().mockResolvedValue([aSession({ id: 's1' })]) },
    })
    useRoster.setState({ openPlanId: 'plan-1' })

    render(<AgentDetail />)

    expect(await screen.findByRole('heading', { name: 'Steps' })).toBeInTheDocument()
  })
})

describe('AgentDetail — config rail', () => {
  test('lists the agent configuration', async () => {
    render(<AgentDetail />)

    expect(await screen.findByText('Runner')).toBeInTheDocument()
    expect(screen.getByText('claude')).toBeInTheDocument()
    expect(screen.getByText('~/work/api')).toBeInTheDocument()
    expect(screen.getByText('filesystem')).toBeInTheDocument()
  })

  test('surfaces why an agent cannot run', async () => {
    useRoster.setState({
      agents: [
        anAgent({ status: 'error', statusDetail: 'not signed in — run `claude auth login`' }),
      ],
    })
    render(<AgentDetail />)

    expect(await screen.findByText(/not signed in/)).toBeInTheDocument()
  })

  test('Edit opens the modal with a draft snapshot', async () => {
    const user = userEvent.setup()
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))

    expect(useRoster.getState().editOpen).toBe(true)
    expect(useRoster.getState().draft?.model).toBe('claude-opus-5')
  })

  test('Manage jumps to the Skills screen', async () => {
    const user = userEvent.setup()
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Manage' }))
    expect(useRoster.getState().screen).toBe('skills')
  })
})

describe('AgentDetail — usage readout', () => {
  test('shows persisted tokens and spend for the open session', async () => {
    withSessions([aSession({ id: 's1' })])
    useRoster.setState({
      usage: {
        s1: {
          sessionId: 's1',
          inputTokens: 100_000,
          outputTokens: 18_402,
          totalTokens: 118402,
          costUsd: 1.24,
        },
      },
    })
    render(<AgentDetail />)

    expect(await screen.findByText('118,402')).toBeInTheDocument()
    expect(screen.getByText('$1.24')).toBeInTheDocument()
    // Derived from the model's window, not from a number stored at turn time
    // that goes stale the moment the agent's model changes.
    expect(screen.getByText('12% of context window')).toBeInTheDocument()
  })

  test('says so rather than drawing a bar for a model it cannot size', async () => {
    // Codex serves whatever slugs are in the user's models_cache.json, so an
    // unknown window is routine. An empty bar would read as "plenty of room".
    withSessions([aSession({ id: 's1' })])
    useRoster.setState({
      agents: [anAgent({ id: 'debugging', model: 'gpt-6-unreleased' })],
      usage: {
        s1: {
          sessionId: 's1',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 900_000,
          costUsd: 0.1,
        },
      },
    })
    render(<AgentDetail />)

    expect(
      await screen.findByText('context window unknown for gpt-6-unreleased'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/% of context window/)).not.toBeInTheDocument()
  })

  test('counts the cached tokens, matching the grid card', async () => {
    withSessions([aSession({ id: 's1' })])
    useRoster.setState({
      usage: {
        s1: {
          sessionId: 's1',
          inputTokens: 18,
          outputTokens: 297,
          totalTokens: 77_913,
          costUsd: 0.94,
        },
      },
    })
    render(<AgentDetail />)

    // Not 315 — the rail used to disagree with the grid about the same turn.
    expect(await screen.findByText('77,913')).toBeInTheDocument()
  })

  test('opens on the newest session rather than none', async () => {
    // The sidebar and the card body name no session, so the pane used to
    // come up empty beside a tab strip full of them. Deliberately not using
    // withSessions, which pre-selects one and would hide this.
    const sessions = [aSession({ id: 'old' }), aSession({ id: 'newest' })]
    installRosterApi({ sessions: { listByAgent: vi.fn().mockResolvedValue(sessions) } })
    useRoster.setState({ sessions: { debugging: sessions }, sess: {} })
    render(<AgentDetail />)

    await waitFor(() => expect(useRoster.getState().sess['debugging']).toBe('newest'))
  })

  test('says no session is open rather than showing zeros', async () => {
    installRosterApi({ sessions: { listByAgent: vi.fn().mockResolvedValue([]) } })
    useRoster.setState({ sessions: { debugging: [] }, sess: {} })
    render(<AgentDetail />)

    expect(await screen.findByText('No session open.')).toBeInTheDocument()
    expect(screen.queryByText(/% of context window/)).not.toBeInTheDocument()
  })

  test('reads zero before a session has run', async () => {
    withSessions([aSession({ id: 's1' })])
    render(<AgentDetail />)

    expect(await screen.findByText('0% of context window')).toBeInTheDocument()
  })
})

describe('AgentDetail — activity indicator', () => {
  test('shows what the agent is doing while a turn runs', async () => {
    withSessions([aSession({ id: 's1' })])
    useRoster.setState({ streaming: { s1: true }, activity: { s1: 'Running pytest -k leak …' } })
    render(<AgentDetail />)

    expect(await screen.findByText('Running pytest -k leak …')).toBeInTheDocument()
  })

  test('falls back to a generic line before any activity is reported', async () => {
    withSessions([aSession({ id: 's1' })])
    useRoster.setState({ streaming: { s1: true } })
    render(<AgentDetail />)

    expect(await screen.findByText('Debugging Agent is working…')).toBeInTheDocument()
  })

  test('shows nothing once the turn is over', async () => {
    withSessions([aSession({ id: 's1' })])
    useRoster.setState({ streaming: { s1: false } })
    render(<AgentDetail />)

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument(),
    )
  })
})

describe('AgentDetail — filing a session under a project', () => {
  const SESSION = aSession({ id: 's1', agentId: 'debugging', title: 'Pool leak' })

  test('offers no picker until projects exist', async () => {
    withSessions([SESSION])
    render(<AgentDetail />)

    await waitFor(() => expect(screen.getByText('Pool leak')).toBeInTheDocument())
    expect(screen.queryByLabelText('Session project')).not.toBeInTheDocument()
  })

  test('shows the session as unfiled by default', async () => {
    withSessions([SESSION])
    useRoster.setState({ projects: [aProject({ id: 'p1', name: 'API reliability' })] })
    render(<AgentDetail />)

    expect(await screen.findByLabelText('Session project')).toHaveValue('none')
  })

  test('shows the project a session is already filed under', async () => {
    withSessions([{ ...SESSION, projectId: 'p1' }])
    useRoster.setState({ projects: [aProject({ id: 'p1', name: 'API reliability' })] })
    render(<AgentDetail />)

    expect(await screen.findByLabelText('Session project')).toHaveValue('p1')
  })

  test('filing it writes through and updates the session', async () => {
    const user = userEvent.setup()
    const filed = { ...SESSION, projectId: 'p1' }
    installRosterApi({
      sessions: {
        listByAgent: vi.fn().mockResolvedValue([SESSION]),
        setProject: vi.fn().mockResolvedValue(filed),
      },
    })
    useRoster.setState({
      sessions: { debugging: [SESSION] },
      sess: { debugging: 's1' },
      projects: [aProject({ id: 'p1', name: 'API reliability' })],
    })
    render(<AgentDetail />)

    await user.selectOptions(await screen.findByLabelText('Session project'), 'p1')

    await waitFor(() =>
      expect(window.roster.sessions.setProject).toHaveBeenCalledWith('s1', 'p1'),
    )
    await waitFor(() =>
      expect(useRoster.getState().sessions['debugging']?.[0]?.projectId).toBe('p1'),
    )
  })

  test('unfiling sends null rather than the sentinel', async () => {
    const user = userEvent.setup()
    const filed = { ...SESSION, projectId: 'p1' }
    installRosterApi({
      sessions: {
        listByAgent: vi.fn().mockResolvedValue([filed]),
        setProject: vi.fn().mockResolvedValue(SESSION),
      },
    })
    useRoster.setState({
      sessions: { debugging: [filed] },
      sess: { debugging: 's1' },
      projects: [aProject({ id: 'p1', name: 'API reliability' })],
    })
    render(<AgentDetail />)

    await user.selectOptions(await screen.findByLabelText('Session project'), 'none')

    await waitFor(() =>
      expect(window.roster.sessions.setProject).toHaveBeenCalledWith('s1', null),
    )
  })
})

describe('AgentDetail — finding a question again', () => {
  const QUESTIONS = [
    {
      question: 'Which cache backend?',
      header: 'Cache',
      multiSelect: false,
      options: [
        { label: 'Redis', description: 'Distributed' },
        { label: 'None', description: 'Skip it' },
      ],
    },
  ]

  const ASKING = {
    id: 'a1',
    sessionId: 's1',
    toolName: 'AskUserQuestion',
    command: 'Which cache backend?',
    questions: QUESTIONS,
    status: 'pending' as const,
    createdAt: 0,
  }

  /** The row the question left in the transcript when it was asked. */
  const ASKED_ROW = {
    id: 'm1',
    sessionId: 's1',
    kind: 'tool' as const,
    tool: 'AskUserQuestion',
    args: 'Which cache backend?',
    input: JSON.stringify({ questions: QUESTIONS }),
    output: '',
    isError: false,
    createdAt: 0,
  }

  beforeEach(() => {
    withSessions([aSession({ id: 's1', status: 'approval' })])
    useRoster.setState({ messages: { s1: [ASKED_ROW] } })
  })

  test('the row it left offers to bring the question back', async () => {
    useRoster.setState({ approvals: { s1: [ASKING] } })
    render(<AgentDetail />)

    expect(await screen.findByRole('button', { name: 'Show question' })).toBeInTheDocument()
  })

  test('clicking it scrolls the question into view', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    useRoster.setState({ approvals: { s1: [ASKING] } })
    render(<AgentDetail />)

    // fireEvent rather than userEvent: assistant-ui re-renders the row
    // between userEvent's pointerdown and its click, so the click lands on a
    // node that is no longer there.
    fireEvent.click(await screen.findByRole('button', { name: 'Show question' }))

    // The card sits below a transcript that may be long; the whole point is
    // getting back to it without hunting.
    expect(scrollIntoView).toHaveBeenCalled()
    scrollIntoView.mockRestore()
  })

  test('offers nothing once the question has been answered', async () => {
    // The agent has already been told; there is nothing left to answer.
    useRoster.setState({ approvals: { s1: [] } })
    render(<AgentDetail />)

    await screen.findByText('AskUserQuestion')
    expect(screen.queryByRole('button', { name: 'Show question' })).not.toBeInTheDocument()
  })

  test('offers nothing on a row that never asked anything', async () => {
    useRoster.setState({
      approvals: { s1: [ASKING] },
      messages: {
        s1: [
          {
            id: 'm2',
            sessionId: 's1',
            kind: 'tool' as const,
            tool: 'Bash',
            args: 'git push',
            output: 'done',
            isError: false,
            createdAt: 0,
          },
        ],
      },
    })
    render(<AgentDetail />)

    await screen.findByText('Bash')
    expect(screen.queryByRole('button', { name: 'Show question' })).not.toBeInTheDocument()
  })
})

describe('AgentDetail — the task a session answers', () => {
  const TASK = aTask({
    id: 'ROS-1',
    title: 'Fix connection pool leak on 504',
    status: 'in_progress',
  })

  test('says nothing about a task for an ordinary session', async () => {
    withSessions([aSession({ id: 'session-1' })])
    useRoster.setState({ tasks: [TASK] })
    render(<AgentDetail />)

    await screen.findByText('Debugging Agent')
    // A session opened from the sidebar answers no task, so the rail should
    // read exactly as it did before this existed.
    expect(screen.queryByRole('button', { name: /^Open ROS/ })).not.toBeInTheDocument()
  })

  test('names the task a mention opened the session from', async () => {
    withSessions([aSession({ id: 'session-1', taskId: 'ROS-1' })])
    useRoster.setState({ tasks: [TASK] })
    render(<AgentDetail />)

    const link = await screen.findByRole('button', { name: 'Open ROS-1' })
    expect(within(link).getByText('ROS-1')).toBeInTheDocument()
    expect(within(link).getByText('Fix connection pool leak on 504')).toBeInTheDocument()
  })

  test('opens the task on the board when the link is clicked', async () => {
    withSessions([aSession({ id: 'session-1', taskId: 'ROS-1' })])
    useRoster.setState({ tasks: [TASK] })
    const user = userEvent.setup()
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Open ROS-1' }))

    const state = useRoster.getState()
    expect(state.screen).toBe('tasks')
    expect(state.openTaskId).toBe('ROS-1')
  })

  test('still names the task when the board has not been loaded', async () => {
    withSessions([aSession({ id: 'session-1', taskId: 'ROS-1' })])
    // The key lives on the session itself, so the link survives a board the
    // renderer has not read yet.
    useRoster.setState({ tasks: [] })
    render(<AgentDetail />)

    expect(await screen.findByRole('button', { name: 'Open ROS-1' })).toBeInTheDocument()
  })
})

describe('AgentDetail — naming a session', () => {
  const UNNAMED = aSession({ id: 's1', agentId: 'debugging', title: 'New session' })

  test('a named session is listed by its name, not by what opened it', async () => {
    withSessions([{ ...UNNAMED, name: 'Pool leak on 504' }])
    render(<AgentDetail />)

    // Anchored: the tab's own delete control is labelled "Delete session
    // <name>", so an unanchored match finds both of them.
    expect(await screen.findByRole('button', { name: /^Pool leak on 504/ })).toBeInTheDocument()
    // "New session" is what every session is created as; showing it on a tab
    // that has been named would be showing the wrong one of the two facts.
    expect(screen.queryByText('New session')).not.toBeInTheDocument()
  })

  test('an unnamed session still reads as something, and asks to be named', async () => {
    withSessions([UNNAMED])
    render(<AgentDetail />)

    // The tab still reads as something — the title it was created with.
    expect(await screen.findByText('New session')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Name this session' })).toBeInTheDocument()
  })

  test('a named session offers a rename instead of the nudge', async () => {
    withSessions([{ ...UNNAMED, name: 'Pool leak on 504' }])
    render(<AgentDetail />)

    expect(await screen.findByRole('button', { name: 'Rename session' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Name this session' })).not.toBeInTheDocument()
  })

  test('naming one writes through and relabels it everywhere', async () => {
    const user = userEvent.setup()
    const named = { ...UNNAMED, name: 'Pool leak on 504' }
    installRosterApi({
      sessions: {
        listByAgent: vi.fn().mockResolvedValue([UNNAMED]),
        setName: vi.fn().mockResolvedValue(named),
      },
    })
    useRoster.setState({ sessions: { debugging: [UNNAMED] }, sess: { debugging: 's1' } })
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Name this session' }))
    await user.type(screen.getByLabelText('Session name'), 'Pool leak on 504{Enter}')

    await waitFor(() =>
      expect(window.roster.sessions.setName).toHaveBeenCalledWith('s1', 'Pool leak on 504'),
    )
    await waitFor(() =>
      expect(useRoster.getState().sessions['debugging']?.[0]?.name).toBe('Pool leak on 504'),
    )
  })

  test('a name that is only whitespace leaves the session unnamed', async () => {
    const user = userEvent.setup()
    installRosterApi({
      sessions: {
        listByAgent: vi.fn().mockResolvedValue([UNNAMED]),
        setName: vi.fn().mockResolvedValue(UNNAMED),
      },
    })
    useRoster.setState({ sessions: { debugging: [UNNAMED] }, sess: { debugging: 's1' } })
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Name this session' }))
    await user.type(screen.getByLabelText('Session name'), '   {Enter}')

    // Never blocking: the box closes, the session carries on unnamed, and
    // nothing is written that would have to be undone.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Name this session' })).toBeInTheDocument(),
    )
    expect(window.roster.sessions.setName).not.toHaveBeenCalled()
  })

  test('clicking away saves what was typed rather than discarding it', async () => {
    const user = userEvent.setup()
    const named = { ...UNNAMED, name: 'Pool leak' }
    installRosterApi({
      sessions: {
        listByAgent: vi.fn().mockResolvedValue([UNNAMED]),
        setName: vi.fn().mockResolvedValue(named),
      },
    })
    useRoster.setState({ sessions: { debugging: [UNNAMED] }, sess: { debugging: 's1' } })
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Name this session' }))
    await user.type(screen.getByLabelText('Session name'), 'Pool leak')
    await user.tab()

    await waitFor(() => expect(window.roster.sessions.setName).toHaveBeenCalledWith('s1', 'Pool leak'))
    // Once only: Enter closes the box, and a close that also fired blur
    // would write the same name twice.
    expect(window.roster.sessions.setName).toHaveBeenCalledTimes(1)
  })

  test('Escape abandons the edit and keeps the name it had', async () => {
    const user = userEvent.setup()
    const named = { ...UNNAMED, name: 'Pool leak on 504' }
    installRosterApi({
      sessions: {
        listByAgent: vi.fn().mockResolvedValue([named]),
        setName: vi.fn().mockResolvedValue(named),
      },
    })
    useRoster.setState({ sessions: { debugging: [named] }, sess: { debugging: 's1' } })
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Rename session' }))
    await user.type(screen.getByLabelText('Session name'), ' rewritten{Escape}')

    expect(window.roster.sessions.setName).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Rename session' })).toBeInTheDocument()
  })

  test('a failed write says so rather than showing a name nothing holds', async () => {
    const user = userEvent.setup()
    installRosterApi({
      sessions: {
        listByAgent: vi.fn().mockResolvedValue([UNNAMED]),
        setName: vi.fn().mockRejectedValue(new Error('unknown session "s1"')),
      },
    })
    useRoster.setState({ sessions: { debugging: [UNNAMED] }, sess: { debugging: 's1' } })
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Name this session' }))
    await user.type(screen.getByLabelText('Session name'), 'Pool leak{Enter}')

    expect(await screen.findByText(/unknown session/)).toBeInTheDocument()
    expect(useRoster.getState().sessions['debugging']?.[0]?.name).toBeNull()
  })

  test('opening a new session asks for its name straight away', async () => {
    const user = userEvent.setup()
    const created = aSession({ id: 's2', agentId: 'debugging', title: 'New session' })
    installRosterApi({
      sessions: {
        listByAgent: vi.fn().mockResolvedValue([UNNAMED]),
        create: vi.fn().mockResolvedValue(created),
      },
    })
    useRoster.setState({ sessions: { debugging: [UNNAMED] }, sess: { debugging: 's1' } })
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: '+ New session' }))

    // The nudge: the box is open and waiting, but it does not take the caret.
    // The composer sets autoFocus={false}, so grabbing focus here would put
    // the first thing typed at a brand-new agent into the name field.
    const box = await screen.findByLabelText('Session name')
    expect(box).not.toHaveFocus()
    expect(useRoster.getState().namingSessionId).toBe('s2')
  })

  test('naming a session deliberately does take the caret', async () => {
    const user = userEvent.setup()
    installRosterApi({
      sessions: { listByAgent: vi.fn().mockResolvedValue([UNNAMED]) },
    })
    useRoster.setState({ sessions: { debugging: [UNNAMED] }, sess: { debugging: 's1' } })
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Name this session' }))

    // Asked for, rather than offered: here the caret is the whole point.
    expect(await screen.findByLabelText('Session name')).toHaveFocus()
  })
})

describe('AgentDetail — deleting a session', () => {
  function twoSessions(): void {
    withSessions([aSession({ id: 's1', title: 'First' }), aSession({ id: 's2', title: 'Second' })])
    useRoster.setState({ sess: { debugging: 's1' } })
  }

  test('offers a delete control on every session tab', async () => {
    twoSessions()
    render(<AgentDetail />)

    expect(await screen.findByRole('button', { name: 'Delete session First' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete session Second' })).toBeInTheDocument()
  })

  test('asks the main process to delete it, and drops the tab when it does', async () => {
    const user = userEvent.setup()
    twoSessions()
    const remove = vi.fn().mockResolvedValue(true)
    installRosterApi({
      sessions: {
        listByAgent: vi.fn().mockResolvedValue([
          aSession({ id: 's1', title: 'First' }),
          aSession({ id: 's2', title: 'Second' }),
        ]),
        remove,
      },
    })
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Delete session First' }))

    expect(remove).toHaveBeenCalledWith('s1')
    await waitFor(() =>
      expect(useRoster.getState().sessions['debugging']?.map((s) => s.id)).toEqual(['s2']),
    )
  })

  test('falls back to another session when the open one goes', async () => {
    const user = userEvent.setup()
    twoSessions()
    installRosterApi({
      sessions: {
        listByAgent: vi.fn().mockResolvedValue([
          aSession({ id: 's1', title: 'First' }),
          aSession({ id: 's2', title: 'Second' }),
        ]),
        remove: vi.fn().mockResolvedValue(true),
      },
    })
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Delete session First' }))

    await waitFor(() => expect(useRoster.getState().sess['debugging']).toBe('s2'))
  })

  test('keeps the session when the confirmation was dismissed', async () => {
    const user = userEvent.setup()
    twoSessions()
    installRosterApi({
      sessions: {
        listByAgent: vi.fn().mockResolvedValue([
          aSession({ id: 's1', title: 'First' }),
          aSession({ id: 's2', title: 'Second' }),
        ]),
        // The dialog lives in the main process; dismissing it resolves false.
        remove: vi.fn().mockResolvedValue(false),
      },
    })
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Delete session First' }))

    await waitFor(() => expect(useRoster.getState().sessions['debugging']).toHaveLength(2))
    expect(useRoster.getState().sess['debugging']).toBe('s1')
  })

  test('says why when the delete failed', async () => {
    const user = userEvent.setup()
    twoSessions()
    installRosterApi({
      sessions: {
        listByAgent: vi.fn().mockResolvedValue([
          aSession({ id: 's1', title: 'First' }),
          aSession({ id: 's2', title: 'Second' }),
        ]),
        remove: vi.fn().mockRejectedValue(new Error('database is locked')),
      },
    })
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: 'Delete session First' }))

    expect(await screen.findByText(/database is locked/)).toBeInTheDocument()
    expect(useRoster.getState().sessions['debugging']).toHaveLength(2)
  })
})
