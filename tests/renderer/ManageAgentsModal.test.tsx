import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Agent } from '@shared/types'
import { ManageAgentsModal } from '@/screens/ManageAgentsModal'
import { useRoster } from '@/state/store'
import { anAgent } from './factories'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()

const AGENTS = [
  anAgent({ id: 'architect', name: 'Architect Agent', model: 'claude-opus-5' }),
  anAgent({ id: 'review', name: 'Review Agent', runner: 'codex', hidden: true }),
]

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  useRoster.setState({ agents: AGENTS, loaded: true })
  installRosterApi()
})

describe('ManageAgentsModal', () => {
  test('lists every agent, including the hidden ones', () => {
    render(<ManageAgentsModal onClose={() => {}} />)

    expect(screen.getByText('Architect Agent')).toBeInTheDocument()
    expect(screen.getByText('Review Agent')).toBeInTheDocument()
  })

  test('marks a hidden agent as not shown', () => {
    render(<ManageAgentsModal onClose={() => {}} />)

    expect(screen.getByRole('button', { name: 'Show Architect Agent' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Show Review Agent' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  test('shows which runner and model each agent uses', () => {
    render(<ManageAgentsModal onClose={() => {}} />)

    expect(screen.getByText('claude · claude-opus-5')).toBeInTheDocument()
  })

  test('hiding an agent writes the flag to its config', async () => {
    const update = vi.fn().mockResolvedValue(AGENTS[0])
    installRosterApi({ agents: { update } })
    render(<ManageAgentsModal onClose={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Show Architect Agent' }))

    expect(update).toHaveBeenCalledWith('architect', { hidden: true })
  })

  test('showing a hidden agent clears the flag', async () => {
    const update = vi.fn().mockResolvedValue(AGENTS[1])
    installRosterApi({ agents: { update } })
    render(<ManageAgentsModal onClose={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Show Review Agent' }))

    expect(update).toHaveBeenCalledWith('review', { hidden: false })
  })

  test('re-reads the roster after a toggle so the list reflects the file', async () => {
    const hidden = [AGENTS[0]!, { ...AGENTS[1]!, hidden: false }]
    installRosterApi({
      agents: {
        update: vi.fn().mockResolvedValue(hidden[1]),
        list: vi.fn().mockResolvedValue(hidden),
      },
    })
    render(<ManageAgentsModal onClose={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Show Review Agent' }))

    expect(useRoster.getState().agents).toEqual(hidden)
  })

  test('surfaces the reason an agent could not be changed', async () => {
    installRosterApi({
      agents: {
        update: vi.fn().mockRejectedValue(new Error('cannot change an agent that does not parse — missing model')),
      },
    })
    render(<ManageAgentsModal onClose={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Show Review Agent' }))

    expect(await screen.findByText(/does not parse/)).toBeInTheDocument()
  })

  test('says so when there are no agents to manage', () => {
    useRoster.setState({ agents: [] })
    render(<ManageAgentsModal onClose={() => {}} />)

    expect(screen.getByText('No agents configured yet.')).toBeInTheDocument()
  })
})

describe('ManageAgentsModal — filtering', () => {
  test('narrows the list to the agents whose name matches', async () => {
    render(<ManageAgentsModal onClose={() => {}} />)

    await userEvent.type(screen.getByRole('textbox', { name: 'Filter agents' }), 'review')

    expect(screen.getByText('Review Agent')).toBeInTheDocument()
    expect(screen.queryByText('Architect Agent')).not.toBeInTheDocument()
  })

  test('matches on runner and model as well as name', async () => {
    render(<ManageAgentsModal onClose={() => {}} />)

    await userEvent.type(screen.getByRole('textbox', { name: 'Filter agents' }), 'codex')

    expect(screen.getByText('Review Agent')).toBeInTheDocument()
    expect(screen.queryByText('Architect Agent')).not.toBeInTheDocument()
  })

  test('counts the matches against the whole roster', async () => {
    render(<ManageAgentsModal onClose={() => {}} />)

    await userEvent.type(screen.getByRole('textbox', { name: 'Filter agents' }), 'review')

    expect(screen.getByText('1 of 2 match')).toBeInTheDocument()
  })

  test('reports how many agents are hidden when nothing is filtered', () => {
    render(<ManageAgentsModal onClose={() => {}} />)

    expect(screen.getByText('2 agents · 1 hidden')).toBeInTheDocument()
  })

  test('counts a roster of one in the singular', () => {
    useRoster.setState({ agents: [AGENTS[0] as Agent] })
    render(<ManageAgentsModal onClose={() => {}} />)

    expect(screen.getByText('1 agent')).toBeInTheDocument()
  })

  test('says nothing matched rather than claiming the roster is empty', async () => {
    render(<ManageAgentsModal onClose={() => {}} />)

    await userEvent.type(screen.getByRole('textbox', { name: 'Filter agents' }), 'nothing')

    expect(screen.getByText('No agents match.')).toBeInTheDocument()
    expect(screen.queryByText('No agents configured yet.')).not.toBeInTheDocument()
  })
})

describe('ManageAgentsModal — pagination', () => {
  const MANY = Array.from({ length: 8 }, (_, i) =>
    anAgent({ id: `agent-${i}`, name: `Agent ${i}` }),
  )

  beforeEach(() => {
    useRoster.setState({ agents: MANY })
  })

  test('shows one page of the roster at a time', () => {
    render(<ManageAgentsModal onClose={() => {}} />)

    expect(screen.getByText('Agent 0')).toBeInTheDocument()
    expect(screen.queryByText('Agent 7')).not.toBeInTheDocument()
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
  })

  test('moves through the roster a page at a time', async () => {
    render(<ManageAgentsModal onClose={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText('Agent 7')).toBeInTheDocument()
    expect(screen.queryByText('Agent 0')).not.toBeInTheDocument()
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
  })

  test('goes back a page', async () => {
    render(<ManageAgentsModal onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))

    expect(screen.getByText('Agent 0')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
  })

  test('leaves paging out for a roster that fits on one page', () => {
    useRoster.setState({ agents: AGENTS })
    render(<ManageAgentsModal onClose={() => {}} />)

    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
  })

  test('returns to the first page when the filter changes', async () => {
    render(<ManageAgentsModal onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    await userEvent.type(screen.getByRole('textbox', { name: 'Filter agents' }), 'Agent')

    expect(screen.getByText('Agent 0')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
  })
})
