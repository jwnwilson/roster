import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SetupState } from '@shared/types'
import { FirstRunCard } from '@/components/FirstRunCard'
import { useRoster } from '@/state/store'
import { anAgent } from './factories'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()

const TECH_LEAD = anAgent({ id: 'tech-lead', name: 'Tech Lead' })
const REVIEWER = anAgent({ id: 'reviewer', name: 'Reviewer' })

function aSetupState(overrides: Partial<SetupState> = {}): SetupState {
  return {
    pending: true,
    startingAgentId: 'tech-lead',
    seededAgentIds: ['tech-lead', 'reviewer'],
    noRunner: false,
    ...overrides,
  }
}

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  installRosterApi()
})

function mount(setup: SetupState | null, agents = [TECH_LEAD, REVIEWER]) {
  useRoster.setState({ setup, agents })
  return render(<FirstRunCard />)
}

describe('FirstRunCard', () => {
  test('says nothing at all once setup has been dismissed', () => {
    const { container } = mount(aSetupState({ pending: false }))
    expect(container).toBeEmptyDOMElement()
  })

  test('says nothing before the setup state has loaded', () => {
    const { container } = mount(null)
    expect(container).toBeEmptyDOMElement()
  })

  test('names the Tech Lead as the agent to start with', () => {
    mount(aSetupState())
    expect(screen.getByRole('button', { name: /start with tech lead/i })).toBeInTheDocument()
  })

  test('lists the other agents that were set up', () => {
    mount(aSetupState())
    expect(screen.getByText(/Reviewer/)).toBeInTheDocument()
  })

  test('starting with the Tech Lead opens it and puts the card away', async () => {
    const api = installRosterApi()
    mount(aSetupState())

    await userEvent.click(screen.getByRole('button', { name: /start with tech lead/i }))

    expect(useRoster.getState().screen).toBe('agent')
    expect(useRoster.getState().agentId).toBe('tech-lead')
    await waitFor(() => expect(api.setup.dismiss).toHaveBeenCalled())
  })

  test('is dismissable, and the dismissal is remembered', async () => {
    const api = installRosterApi()
    mount(aSetupState())

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument()
    await waitFor(() => expect(api.setup.dismiss).toHaveBeenCalled())
  })

  test('comes back with the reason when the dismissal could not be saved', async () => {
    installRosterApi({
      setup: { dismiss: vi.fn().mockRejectedValue(new Error('disk is full')) },
    })
    mount(aSetupState())

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(await screen.findByText(/disk is full/)).toBeInTheDocument()
    expect(useRoster.getState().setup?.pending).toBe(true)
  })

  test('explains what to install when no runner was found, and offers nothing to start', () => {
    mount(aSetupState({ noRunner: true, startingAgentId: null, seededAgentIds: [] }), [])

    expect(screen.getByText(/Claude Code/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start with/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument()
  })

  test('offers no starting agent when the one it seeded has since been deleted', () => {
    mount(aSetupState({ startingAgentId: null }), [REVIEWER])
    expect(screen.queryByRole('button', { name: /start with/i })).not.toBeInTheDocument()
  })
})
