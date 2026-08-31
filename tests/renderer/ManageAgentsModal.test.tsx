import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
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
