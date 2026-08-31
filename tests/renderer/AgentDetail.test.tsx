import { render, screen, waitFor, within } from '@testing-library/react'
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

    const active = await screen.findByRole('button', { name: /Second/ })
    expect(active).toHaveAttribute('aria-current', 'true')
  })

  test('switching tabs changes the selected session', async () => {
    const user = userEvent.setup()
    withSessions([aSession({ id: 's1', title: 'First' }), aSession({ id: 's2', title: 'Second' })])
    render(<AgentDetail />)

    await user.click(await screen.findByRole('button', { name: /Second/ }))
    expect(useRoster.getState().sess['debugging']).toBe('s2')
  })

  test('shows the origin of an agent-opened session', async () => {
    withSessions([aSession({ id: 's1', origin: 'agent', from: 'Architect Agent' })])
    render(<AgentDetail />)

    const tab = await screen.findByRole('button', { name: /Session leak/ })
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
