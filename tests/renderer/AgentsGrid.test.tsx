import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { AgentsGrid } from '@/screens/AgentsGrid'
import { useRoster } from '@/state/store'
import { anAgent, aSession } from './factories'

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
    useRoster.setState({ agents: [anAgent({ status: 'running' }), anAgent({ id: 'b' })] })
    render(<AgentsGrid />)

    expect(screen.getByText('2 configured · 1 running')).toBeInTheDocument()
  })

  test('labels each status with the handoff vocabulary, not the raw key', () => {
    render(<AgentsGrid />)

    expect(screen.getByText('needs you')).toBeInTheDocument()
    expect(screen.getByText('finished')).toBeInTheDocument()
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
