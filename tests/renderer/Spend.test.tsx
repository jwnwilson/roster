import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { Spend } from '@/screens/Spend'
import { useRoster } from '@/state/store'
import { NO_PROJECT } from '@shared/types'
import { anAgent, aProject, aRunner } from './factories'

const INITIAL = useRoster.getState()

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  useRoster.setState({ loaded: true })
})

/** A roster spanning two providers, with one session's spend unassigned. */
function seedRoster(): void {
  useRoster.setState({
    runners: [
      aRunner({ id: 'claude', provider: 'Anthropic' }),
      aRunner({ id: 'codex', provider: 'OpenAI' }),
    ],
    agents: [
      anAgent({
        id: 'debugging',
        name: 'Debugging Agent',
        runner: 'claude',
        model: 'claude-opus-5',
      }),
      anAgent({ id: 'review', name: 'Review Agent', runner: 'codex', model: 'gpt-5.5' }),
    ],
    agentUsage: {
      debugging: { tokens: 86_100, costUsd: 1.43 },
      review: { tokens: 44_700, costUsd: 0.48 },
    },
    projects: [aProject({ id: 'api', name: 'API reliability' })],
    spendByProject: {
      api: { tokens: 86_100, costUsd: 1.43 },
      [NO_PROJECT]: { tokens: 44_700, costUsd: 0.48 },
    },
  })
}

describe('Spend', () => {
  test('heads the screen with what the whole roster has cost', () => {
    seedRoster()
    render(<Spend />)

    expect(screen.getByText('$1.91 across all agents')).toBeInTheDocument()
  })

  test('groups spend three ways', () => {
    seedRoster()
    render(<Spend />)

    expect(screen.getByText('By provider')).toBeInTheDocument()
    expect(screen.getByText('By agent')).toBeInTheDocument()
    expect(screen.getByText('By project')).toBeInTheDocument()
  })

  test('shows each provider with its models nested underneath', () => {
    seedRoster()
    render(<Spend />)

    expect(screen.getByText('Anthropic')).toBeInTheDocument()
    expect(screen.getByText('claude-opus-5')).toBeInTheDocument()
    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getByText('gpt-5.5')).toBeInTheDocument()
  })

  test('names every agent that has run', () => {
    seedRoster()
    render(<Spend />)

    expect(screen.getByText('Debugging Agent')).toBeInTheDocument()
    expect(screen.getByText('Review Agent')).toBeInTheDocument()
  })

  test('buckets sessions with no project under "No project"', () => {
    seedRoster()
    render(<Spend />)

    expect(screen.getByText('API reliability')).toBeInTheDocument()
    expect(screen.getByText('No project')).toBeInTheDocument()
  })

  test('sizes each bar against the largest in its own group', () => {
    seedRoster()
    const { container } = render(<Spend />)

    const fills = [...container.querySelectorAll('[style*="width"]')] as HTMLElement[]
    // Anthropic is the biggest provider, so it fills its track.
    expect(fills[0]?.style.width).toBe('100%')
  })

  test('says nothing has been spent rather than drawing three empty charts', () => {
    render(<Spend />)

    expect(screen.getByText('Nothing spent yet.')).toBeInTheDocument()
    expect(screen.queryByText('By provider')).not.toBeInTheDocument()
  })

  test('shows $0.00 for a runner that reports no cost, not a missing row', () => {
    useRoster.setState({
      runners: [aRunner({ id: 'codex', provider: 'OpenAI' })],
      agents: [anAgent({ id: 'review', name: 'Review Agent', runner: 'codex', model: 'gpt-5.5' })],
      agentUsage: { review: { tokens: 118_400, costUsd: 0 } },
      spendByProject: {},
    })
    render(<Spend />)

    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0)
  })

  test('is not narrowed by the project filter the board and grid share', () => {
    seedRoster()
    useRoster.setState({ projectFilter: 'api' })
    render(<Spend />)

    // Spend is a whole-roster view; its By-project chart is the breakdown.
    expect(screen.getByText('Review Agent')).toBeInTheDocument()
    expect(screen.getByText('$1.91 across all agents')).toBeInTheDocument()
  })
})

describe('Spend — reachable from the sidebar', () => {
  test('the nav row opens it and shows the running total', async () => {
    const { Sidebar } = await import('@/components/Sidebar')
    seedRoster()
    render(<Sidebar />)

    const spend = screen.getByRole('button', { name: /Spend/ })
    expect(spend).toBeEnabled()
    expect(within(spend).getByText('$1.91')).toBeInTheDocument()

    await userEvent.click(spend)

    expect(useRoster.getState().screen).toBe('spend')
  })
})
