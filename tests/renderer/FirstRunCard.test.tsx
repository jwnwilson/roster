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

  test('says the engine did not start, shows why, and offers nothing to start', () => {
    useRoster.setState({
      runners: [{ id: 'pi', provider: 'Pi', installed: false, ready: false, auth: 'none', detail: 'Pi could not start: boom' }],
    })
    mount(aSetupState({ noRunner: true, startingAgentId: null, seededAgentIds: [] }), [])

    expect(screen.getByText(/could not start its agent engine/)).toBeInTheDocument()
    expect(screen.getByText(/Pi could not start: boom/)).toBeInTheDocument()
    expect(screen.queryByText(/Claude Code|Codex/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start with/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument()
  })

  describe('when no model provider is signed in', () => {
    const ANTHROPIC = {
      id: 'anthropic',
      name: 'Anthropic',
      signedIn: false,
      subscription: false,
      methods: [
        { method: 'oauth' as const, label: 'Sign in with account', description: 'Claude Pro/Max — opens your browser' },
        { method: 'api_key' as const, label: 'Enter an API key', description: 'Anthropic API key' },
      ],
    }

    function mountSignedOut(providers = [ANTHROPIC]) {
      const api = installRosterApi({ signIn: { providers: vi.fn().mockResolvedValue(providers) } })
      mount(aSetupState({ needsSignIn: true }))
      return api
    }

    test('offers sign-in in place of starting, with account sign-in first', async () => {
      mountSignedOut()
      expect(await screen.findByRole('button', { name: 'Sign in with Anthropic' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /start with/i })).not.toBeInTheDocument()
    })

    test('shows the sign-in card even when the marker says setup is done (an upgrade)', async () => {
      installRosterApi({ signIn: { providers: vi.fn().mockResolvedValue([ANTHROPIC]) } })
      mount(aSetupState({ pending: false, needsSignIn: true }))
      expect(await screen.findByRole('button', { name: 'Sign in with Anthropic' })).toBeInTheDocument()
    })

    test('"Later" hides the card for this session, without marking setup as dismissed', async () => {
      const api = mountSignedOut()
      await userEvent.click(await screen.findByRole('button', { name: /later/i }))
      expect(screen.queryByRole('button', { name: 'Sign in with Anthropic' })).not.toBeInTheDocument()
      expect(api.setup.dismiss).not.toHaveBeenCalled()
    })

    test('"Other provider or API key" opens the provider list', async () => {
      mountSignedOut()
      await userEvent.click(await screen.findByRole('button', { name: /other provider/i }))
      expect(await screen.findByRole('dialog', { name: /sign in to a model provider/i })).toBeInTheDocument()
    })

    test('after a successful sign-in, the card moves on to starting with the Tech Lead', async () => {
      const api = installRosterApi({
        signIn: {
          providers: vi.fn().mockResolvedValue([ANTHROPIC]),
          start: vi.fn().mockResolvedValue({ ok: true }),
        },
        setup: {
          state: vi.fn().mockResolvedValue(aSetupState({ needsSignIn: false })),
        },
      })
      mount(aSetupState({ needsSignIn: true }))

      await userEvent.click(await screen.findByRole('button', { name: 'Sign in with Anthropic' }))

      expect(api.signIn.start).toHaveBeenCalledWith('anthropic', 'oauth')
      expect(await screen.findByRole('button', { name: /start with tech lead/i })).toBeInTheDocument()
      expect(screen.getByText(/Signed in to Anthropic/)).toBeInTheDocument()
    })
  })

  test('offers no starting agent when the one it seeded has since been deleted', () => {
    mount(aSetupState({ startingAgentId: null }), [REVIEWER])
    expect(screen.queryByRole('button', { name: /start with/i })).not.toBeInTheDocument()
  })
})
