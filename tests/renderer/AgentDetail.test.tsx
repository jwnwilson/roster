import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AgentDetail } from '@/screens/AgentDetail'
import { useRoster } from '@/state/store'
import type { Session } from '@shared/types'
import { anAgent, aSession } from './factories'
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
          contextUsed: 0.58,
        },
      },
    })
    render(<AgentDetail />)

    expect(await screen.findByText('118,402')).toBeInTheDocument()
    expect(screen.getByText('$1.24')).toBeInTheDocument()
    expect(screen.getByText('58% of context window')).toBeInTheDocument()
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
