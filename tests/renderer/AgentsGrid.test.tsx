import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { AgentsGrid } from '@/screens/AgentsGrid'
import { useRoster } from '@/state/store'
import { anAgent, aProject, aSession } from './factories'

const INITIAL = useRoster.getState()

const AGENTS = [
  anAgent({ id: 'architect', name: 'Architect Agent', model: 'claude-opus-5' }),
  anAgent({ id: 'debugging', name: 'Debugging Agent', model: 'gpt-5', status: 'approval' }),
  anAgent({ id: 'review', name: 'Review Agent', model: 'gemini-2.5-pro', status: 'done' }),
]

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  useRoster.setState({ agents: AGENTS, loaded: true })
})

describe('AgentsGrid — rendering', () => {
  test('renders a card per agent', () => {
    render(<AgentsGrid />)

    expect(screen.getByText('Architect Agent')).toBeInTheDocument()
    expect(screen.getByText('Debugging Agent')).toBeInTheDocument()
    expect(screen.getByText('Review Agent')).toBeInTheDocument()
  })

  test('summarises the roster using the handoff wording', () => {
    render(<AgentsGrid />)
    expect(screen.getByText('3 configured · 0 running')).toBeInTheDocument()
  })

  test('counts running agents in the summary', () => {
    // An agent is "running" because a session of its is, not by its own field.
    useRoster.setState({
      agents: [anAgent({ id: 'a' }), anAgent({ id: 'b' })],
      sessions: { a: [aSession({ agentId: 'a', status: 'running' })] },
    })
    render(<AgentsGrid />)

    expect(screen.getByText('2 configured · 1 running')).toBeInTheDocument()
  })

  test('labels each status with the handoff vocabulary, not the raw key', () => {
    useRoster.setState({
      sessions: {
        debugging: [aSession({ agentId: 'debugging', status: 'approval' })],
        review: [aSession({ agentId: 'review', status: 'done' })],
      },
    })
    render(<AgentsGrid />)

    expect(screen.getByText('needs you')).toBeInTheDocument()
    expect(screen.getByText('finished')).toBeInTheDocument()
  })

  test('the dot follows its sessions rather than staying idle', () => {
    useRoster.setState({
      agents: [anAgent({ id: 'a', name: 'Busy Agent' })],
      sessions: {
        a: [
          aSession({ id: 's1', agentId: 'a', status: 'done' }),
          aSession({ id: 's2', agentId: 'a', status: 'approval' }),
        ],
      },
    })
    render(<AgentsGrid />)

    // Blocked outranks finished: that is the one that wants attention.
    expect(screen.getByText('needs you')).toBeInTheDocument()
    expect(screen.queryByText('idle')).not.toBeInTheDocument()
  })

  test('an unusable runner still shows as an error whatever its sessions say', () => {
    useRoster.setState({
      agents: [anAgent({ id: 'a', status: 'error', statusDetail: 'not signed in' })],
      sessions: { a: [aSession({ agentId: 'a', status: 'running' })] },
    })
    render(<AgentsGrid />)

    expect(screen.getByText('error')).toBeInTheDocument()
  })

  test('shows the model id and working directory on each card', () => {
    render(<AgentsGrid />)

    expect(screen.getByText('claude-opus-5')).toBeInTheDocument()
    expect(screen.getByText('gpt-5')).toBeInTheDocument()
    expect(screen.getAllByText('~/work/api')).toHaveLength(3)
  })
})

describe('AgentsGrid — error status', () => {
  test('shows the reason a runner is unusable instead of the prompt', () => {
    useRoster.setState({
      agents: [
        anAgent({
          status: 'error',
          statusDetail: 'not signed in — run `claude auth login`',
        }),
      ],
    })
    render(<AgentsGrid />)

    expect(screen.getByText('not signed in — run `claude auth login`')).toBeInTheDocument()
    expect(screen.queryByText('Reproduce before you fix.')).not.toBeInTheDocument()
  })
})

describe('AgentsGrid — filtering', () => {
  test('filters cards by name as the user types', async () => {
    const user = userEvent.setup()
    render(<AgentsGrid />)

    await user.type(screen.getByLabelText('Filter agents'), 'review')

    expect(screen.getByText('Review Agent')).toBeInTheDocument()
    expect(screen.queryByText('Architect Agent')).not.toBeInTheDocument()
  })

  test('switches the summary to a match count while filtering', async () => {
    const user = userEvent.setup()
    render(<AgentsGrid />)

    await user.type(screen.getByLabelText('Filter agents'), 'review')

    expect(screen.getByText('1 of 3 match')).toBeInTheDocument()
  })

  test('shows an empty state when nothing matches', async () => {
    const user = userEvent.setup()
    render(<AgentsGrid />)

    await user.type(screen.getByLabelText('Filter agents'), 'zzz')

    expect(screen.getByText('No agents match that filter.')).toBeInTheDocument()
  })

  test('offers to create an agent when the roster is genuinely empty', () => {
    useRoster.setState({ agents: [] })
    render(<AgentsGrid />)

    expect(screen.getByText('No agents configured yet.')).toBeInTheDocument()
  })
})

describe('AgentsGrid — hidden agents', () => {
  beforeEach(() => {
    useRoster.setState({
      agents: [
        anAgent({ id: 'architect', name: 'Architect Agent' }),
        anAgent({ id: 'debugging', name: 'Debugging Agent' }),
        anAgent({ id: 'review', name: 'Review Agent', hidden: true }),
      ],
    })
  })

  test('does not render a card for a hidden agent', () => {
    render(<AgentsGrid />)

    expect(screen.getByText('Architect Agent')).toBeInTheDocument()
    expect(screen.queryByText('Review Agent')).not.toBeInTheDocument()
  })

  test('reports how many agents are hidden in the summary', () => {
    render(<AgentsGrid />)
    expect(screen.getByText('2 shown · 1 hidden · 0 running')).toBeInTheDocument()
  })

  test('counts only visible agents while filtering', async () => {
    const user = userEvent.setup()
    render(<AgentsGrid />)

    await user.type(screen.getByLabelText('Filter agents'), 'architect')

    // 2, not 3: a hidden agent could never have matched.
    expect(screen.getByText('1 of 2 match')).toBeInTheDocument()
  })

  test('says every agent is hidden rather than claiming none are configured', () => {
    useRoster.setState({ agents: [anAgent({ id: 'architect', hidden: true })] })
    render(<AgentsGrid />)

    expect(screen.getByText('Every agent is hidden.')).toBeInTheDocument()
    expect(screen.queryByText('No agents configured yet.')).not.toBeInTheDocument()
  })

  test('the Manage button opens the management modal', async () => {
    const user = userEvent.setup()
    render(<AgentsGrid />)

    await user.click(screen.getByRole('button', { name: 'Manage' }))

    expect(screen.getByRole('dialog', { name: 'Manage agents' })).toBeInTheDocument()
  })

  test('a hidden agent can be brought back from the management modal', async () => {
    const user = userEvent.setup()
    render(<AgentsGrid />)

    await user.click(screen.getByRole('button', { name: 'Manage' }))

    expect(screen.getByRole('button', { name: 'Show Review Agent' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})

describe('AgentsGrid — navigation', () => {
  test('clicking a card opens that agent', async () => {
    const user = userEvent.setup()
    render(<AgentsGrid />)

    await user.click(screen.getByText('Review Agent'))

    expect(useRoster.getState().screen).toBe('agent')
    expect(useRoster.getState().agentId).toBe('review')
  })

  test('clicking a session chip opens that session directly', async () => {
    const user = userEvent.setup()
    useRoster.setState({
      sessions: {
        review: [aSession({ id: 'review-2', agentId: 'review', title: 'Style pass on api/' })],
      },
    })
    render(<AgentsGrid />)

    await user.click(screen.getByText('Style pass on api/'))

    expect(useRoster.getState().agentId).toBe('review')
    expect(useRoster.getState().sess['review']).toBe('review-2')
  })

  test('the New agent button routes to the create form', async () => {
    const user = userEvent.setup()
    render(<AgentsGrid />)

    await user.click(screen.getByRole('button', { name: 'New agent' }))

    expect(useRoster.getState().screen).toBe('new')
  })
})

describe('AgentsGrid — sessions', () => {
  test('marks an agent-opened session with the arrow glyph', () => {
    useRoster.setState({
      sessions: {
        review: [aSession({ id: 'r1', agentId: 'review', origin: 'agent', title: 'PR #482' })],
      },
    })
    render(<AgentsGrid />)

    const chip = screen.getByText('PR #482').closest('[role="button"]')
    expect(chip).not.toBeNull()
    expect(within(chip as HTMLElement).getByText('↳')).toBeInTheDocument()
  })

  test('marks a user-opened session with the bullet glyph', () => {
    useRoster.setState({
      sessions: { review: [aSession({ id: 'r1', agentId: 'review', origin: 'you' })] },
    })
    render(<AgentsGrid />)

    const chip = screen.getByText('Session leak on 504').closest('[role="button"]')
    expect(within(chip as HTMLElement).getByText('•')).toBeInTheDocument()
  })

  test('says so when an agent has no sessions yet', () => {
    render(<AgentsGrid />)
    expect(screen.getAllByText('no sessions yet').length).toBe(3)
  })
})

describe('AgentsGrid — transcript preview', () => {
  const LINES = [
    { who: 'you', role: 'user' as const, text: 'Find the leak.' },
    { who: 'Debugging Agent', role: 'agent' as const, text: 'Reproduced it.' },
    { who: 'tool', role: 'tool' as const, text: 'run_command pytest -k leak' },
    { who: 'Debugging Agent', role: 'agent' as const, text: 'Patch ready.' },
  ]

  test('shows the recent conversation, not the system prompt', () => {
    useRoster.setState({
      agents: [anAgent({ id: 'debugging', systemPrompt: 'Reproduce before you fix.' })],
      transcripts: { debugging: LINES },
    })
    render(<AgentsGrid />)

    expect(screen.getByText('Find the leak.')).toBeInTheDocument()
    expect(screen.getByText('Patch ready.')).toBeInTheDocument()
    expect(screen.queryByText('Reproduce before you fix.')).not.toBeInTheDocument()
  })

  test('labels each line with who said it', () => {
    useRoster.setState({
      agents: [anAgent({ id: 'debugging' })],
      transcripts: { debugging: LINES },
    })
    render(<AgentsGrid />)

    expect(screen.getByText('you')).toBeInTheDocument()
    expect(screen.getByText('tool')).toBeInTheDocument()
  })

  test('fades older lines, leaving the newest fully opaque', () => {
    useRoster.setState({
      agents: [anAgent({ id: 'debugging' })],
      transcripts: { debugging: LINES },
    })
    render(<AgentsGrid />)

    const newest = screen.getByText('Patch ready.').closest('div')
    const oldest = screen.getByText('Find the leak.').closest('div')

    expect(newest).toHaveStyle({ opacity: '1' })
    expect(oldest).toHaveStyle({ opacity: '0.52' })
  })

  test('says so when an agent has not spoken yet', () => {
    useRoster.setState({ agents: [anAgent({ id: 'debugging' })], transcripts: {} })
    render(<AgentsGrid />)

    expect(screen.getByText('No messages yet.')).toBeInTheDocument()
  })

  test('an unusable runner still shows its reason instead of a transcript', () => {
    useRoster.setState({
      agents: [anAgent({ id: 'debugging', status: 'error', statusDetail: 'not signed in' })],
      transcripts: { debugging: LINES },
    })
    render(<AgentsGrid />)

    expect(screen.getByText('not signed in')).toBeInTheDocument()
    expect(screen.queryByText('Find the leak.')).not.toBeInTheDocument()
  })

  test('each agent shows only its own conversation', () => {
    useRoster.setState({
      agents: [anAgent({ id: 'debugging' }), anAgent({ id: 'review', name: 'Review Agent' })],
      transcripts: {
        debugging: [{ who: 'you', role: 'user' as const, text: 'debug talk' }],
        review: [{ who: 'you', role: 'user' as const, text: 'review talk' }],
      },
    })
    render(<AgentsGrid />)

    expect(screen.getByText('debug talk')).toBeInTheDocument()
    expect(screen.getByText('review talk')).toBeInTheDocument()
  })
})

describe('AgentsGrid — spend', () => {
  test('shows what an agent has spent across all its sessions', () => {
    useRoster.setState({
      agents: [anAgent({ id: 'debugging', name: 'Debugging Agent' })],
      agentUsage: { debugging: { tokens: 86_120, costUsd: 0.91 } },
    })
    render(<AgentsGrid />)

    expect(screen.getByText('86.1k tok')).toBeInTheDocument()
    expect(screen.getByText('$0.91')).toBeInTheDocument()
  })

  test('an agent that has never run reads as zero', () => {
    useRoster.setState({
      agents: [anAgent({ id: 'debugging' })],
      agentUsage: {},
    })
    render(<AgentsGrid />)

    expect(screen.getByText('0 tok')).toBeInTheDocument()
    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })

  test('each card shows its own total, not the roster-wide one', () => {
    useRoster.setState({
      agents: [
        anAgent({ id: 'a', name: 'A Agent' }),
        anAgent({ id: 'b', name: 'B Agent' }),
      ],
      agentUsage: {
        a: { tokens: 1_000, costUsd: 1 },
        b: { tokens: 2_000, costUsd: 2 },
      },
    })
    render(<AgentsGrid />)

    expect(screen.getByText('1.0k tok')).toBeInTheDocument()
    expect(screen.getByText('2.0k tok')).toBeInTheDocument()
  })
})

describe('AgentsGrid — project filter', () => {
  const PROJECTS = [
    aProject({ id: 'p1', name: 'API reliability' }),
    aProject({ id: 'p2', name: 'Q3 planning' }),
  ]

  beforeEach(() => {
    useRoster.setState({
      projects: PROJECTS,
      agents: [
        anAgent({ id: 'debugging', name: 'Debugging Agent' }),
        anAgent({ id: 'estimation', name: 'Estimation Agent' }),
      ],
      sessions: {
        debugging: [
          aSession({ id: 'd1', agentId: 'debugging', title: 'Pool leak', projectId: 'p1' }),
          aSession({ id: 'd2', agentId: 'debugging', title: 'Roadmap split', projectId: 'p2' }),
        ],
        estimation: [
          aSession({ id: 'e1', agentId: 'estimation', title: 'Estimates', projectId: 'p2' }),
        ],
      },
    })
  })

  test('offers every project plus an all-projects option', () => {
    render(<AgentsGrid />)

    const select = screen.getByLabelText('Filter by project')
    expect(within(select).getByText('All projects')).toBeInTheDocument()
    expect(within(select).getByText('API reliability')).toBeInTheDocument()
    expect(within(select).getByText('Q3 planning')).toBeInTheDocument()
  })

  test('shows every agent until a project is picked', () => {
    render(<AgentsGrid />)

    expect(screen.getByText('Debugging Agent')).toBeInTheDocument()
    expect(screen.getByText('Estimation Agent')).toBeInTheDocument()
  })

  test('hides an agent with no session in the chosen project', async () => {
    const user = userEvent.setup()
    render(<AgentsGrid />)

    await user.selectOptions(screen.getByLabelText('Filter by project'), 'p1')

    expect(screen.getByText('Debugging Agent')).toBeInTheDocument()
    expect(screen.queryByText('Estimation Agent')).not.toBeInTheDocument()
  })

  test('narrows the chips on a card it keeps, not just the cards', async () => {
    const user = userEvent.setup()
    render(<AgentsGrid />)

    await user.selectOptions(screen.getByLabelText('Filter by project'), 'p1')

    // A card that survives the filter but still lists every session would
    // be lying about what it is showing.
    expect(screen.getByText('Pool leak')).toBeInTheDocument()
    expect(screen.queryByText('Roadmap split')).not.toBeInTheDocument()
  })

  test('hides an agent whose sessions have no project at all', async () => {
    const user = userEvent.setup()
    useRoster.setState({
      sessions: {
        debugging: [aSession({ id: 'd1', agentId: 'debugging', projectId: null })],
      },
    })
    render(<AgentsGrid />)

    await user.selectOptions(screen.getByLabelText('Filter by project'), 'p1')

    expect(screen.queryByText('Debugging Agent')).not.toBeInTheDocument()
  })

  test('switches the summary to a match count while filtering by project', async () => {
    const user = userEvent.setup()
    render(<AgentsGrid />)

    await user.selectOptions(screen.getByLabelText('Filter by project'), 'p1')

    expect(screen.getByText('1 of 2 match')).toBeInTheDocument()
  })

  test('combines with the text filter rather than replacing it', async () => {
    const user = userEvent.setup()
    render(<AgentsGrid />)

    await user.selectOptions(screen.getByLabelText('Filter by project'), 'p2')
    await user.type(screen.getByLabelText('Filter agents'), 'estimation')

    expect(screen.getByText('Estimation Agent')).toBeInTheDocument()
    expect(screen.queryByText('Debugging Agent')).not.toBeInTheDocument()
  })

  test('says nothing matched rather than offering to create an agent', async () => {
    const user = userEvent.setup()
    useRoster.setState({ sessions: {} })
    render(<AgentsGrid />)

    await user.selectOptions(screen.getByLabelText('Filter by project'), 'p1')

    expect(screen.getByText('No agents match that filter.')).toBeInTheDocument()
  })
})

describe('AgentsGrid — status bar', () => {
  test('carries the handoff note about agent-opened sessions', () => {
    render(<AgentsGrid />)
    expect(screen.getByText('session opened by another agent')).toBeInTheDocument()
  })

  test('totals what the whole roster has spent', () => {
    useRoster.setState({
      agentUsage: {
        architect: { tokens: 200_000, costUsd: 2.5 },
        debugging: { tokens: 212_000, costUsd: 1.37 },
      },
    })
    render(<AgentsGrid />)

    expect(screen.getByText('roster 412.0k tok · $3.87')).toBeInTheDocument()
  })

  test('reads as zero rather than blank when nothing has run', () => {
    useRoster.setState({ agentUsage: {} })
    render(<AgentsGrid />)

    expect(screen.getByText('roster 0 tok · $0.00')).toBeInTheDocument()
  })
})
