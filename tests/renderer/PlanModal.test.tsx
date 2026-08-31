import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Plan, PlanComment } from '@shared/types'
import type { RosterApi } from '@shared/ipc'
import { PlanModal } from '@/screens/PlanModal'
import { useRoster } from '@/state/store'
import { anAgent, aPlan, aPlanComment } from './factories'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()

const BODY = '## Steps\n\n- reproduce\n- patch\n'

/**
 * Opens the modal on a plan.
 *
 * The store is seeded so the first paint has something to show, and the API
 * is stubbed to return the same thing — which is what actually happens, since
 * the modal always re-reads the body it renders.
 */
function open(
  plan: Plan = aPlan(),
  comments: PlanComment[] = [],
  overrides: Record<string, unknown> = {},
): RosterApi {
  const api = installRosterApi({
    plans: {
      read: vi.fn().mockResolvedValue({ plan, body: BODY }),
      comments: vi.fn().mockResolvedValue(comments),
      ...overrides,
    },
  })
  useRoster.setState({
    openPlanId: plan.id,
    plans: { [plan.id]: { plan, body: BODY } },
    planComments: { [plan.id]: comments },
  })
  return api
}

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  useRoster.setState({
    agents: [anAgent({ id: 'debugging', name: 'Debugging Agent', mcpServers: ['plans'] })],
  })
  installRosterApi()
})

describe('reading a plan', () => {
  test('renders it as Markdown, not as source', async () => {
    open()
    render(<PlanModal />)

    expect(await screen.findByRole('heading', { name: 'Steps' })).toBeInTheDocument()
    expect(screen.queryByText('## Steps')).not.toBeInTheDocument()
  })

  test('names the plan and which version this is', async () => {
    open(aPlan({ version: 3 }))
    render(<PlanModal />)

    expect(await screen.findByText('Archive projects')).toBeInTheDocument()
    expect(screen.getByText('v3')).toBeInTheDocument()
  })

  test('shows nothing when no plan is open', () => {
    render(<PlanModal />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('reads the plan over IPC when the store has not got it', async () => {
    const plan = aPlan()
    const api = installRosterApi({
      plans: {
        read: vi.fn().mockResolvedValue({ plan, body: BODY }),
        comments: vi.fn().mockResolvedValue([]),
      },
    })
    useRoster.setState({ openPlanId: plan.id })

    render(<PlanModal />)

    await waitFor(() => expect(api.plans.read).toHaveBeenCalledWith('plan-1'))
    expect(await screen.findByRole('heading', { name: 'Steps' })).toBeInTheDocument()
  })

  test('re-reads the body when the agent has revised it underneath you', async () => {
    const plan = aPlan()
    const api = open(plan)
    render(<PlanModal />)
    await screen.findByRole('heading', { name: 'Steps' })

    // What the next read returns, now that the agent has rewritten it.
    ;(api.plans.read as ReturnType<typeof vi.fn>).mockResolvedValue({
      plan: aPlan({ version: 2 }),
      body: '## Rewritten\n',
    })

    // What a broadcast from the main process does.
    useRoster.getState().applyPlanEvent({ type: 'plan-updated', plan: aPlan({ version: 2 }) })

    expect(await screen.findByRole('heading', { name: 'Rewritten' })).toBeInTheDocument()
    expect(api.plans.read).toHaveBeenCalledTimes(2)
  })
})

describe('the thread on a plan', () => {
  test('shows who said what', async () => {
    open(aPlan(), [
      aPlanComment({ text: 'Use a nullable timestamp.' }),
      aPlanComment({ id: 'c2', author: 'Debugging Agent', tone: 'agent', text: 'Revised the plan — v2.' }),
    ])
    render(<PlanModal />)

    expect(await screen.findByText('Use a nullable timestamp.')).toBeInTheDocument()
    expect(screen.getByText('Revised the plan — v2.')).toBeInTheDocument()
    expect(screen.getByText('Debugging Agent')).toBeInTheDocument()
  })

  test('says so when nothing has been said', async () => {
    open()
    render(<PlanModal />)

    expect(await screen.findByText('No comments yet.')).toBeInTheDocument()
  })
})

describe('sending comments back', () => {
  test('submits what you wrote', async () => {
    const api = open(aPlan(), [], {
      submit: vi.fn().mockResolvedValue(aPlan({ status: 'revising' })),
    })
    render(<PlanModal />)
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Add a comment'), 'use a timestamp')
    await user.click(screen.getByRole('button', { name: 'Send comments' }))

    await waitFor(() =>
      expect(api.plans.submit).toHaveBeenCalledWith('plan-1', 'use a timestamp'),
    )
  })

  test('will not send an empty note', async () => {
    open()
    render(<PlanModal />)

    expect(await screen.findByRole('button', { name: 'Send comments' })).toBeDisabled()
  })

  test('clears the box once it has gone', async () => {
    open(aPlan(), [], { submit: vi.fn().mockResolvedValue(aPlan()) })
    render(<PlanModal />)
    const user = userEvent.setup()

    const box = await screen.findByLabelText('Add a comment')
    await user.type(box, 'use a timestamp')
    await user.click(screen.getByRole('button', { name: 'Send comments' }))

    await waitFor(() => expect(box).toHaveValue(''))
  })

  test('says what went wrong rather than losing the note', async () => {
    open(aPlan(), [], {
      submit: vi.fn().mockRejectedValue(new Error('this session is already running')),
    })
    render(<PlanModal />)
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Add a comment'), 'x')
    await user.click(screen.getByRole('button', { name: 'Send comments' }))

    expect(await screen.findByText('this session is already running')).toBeInTheDocument()
    expect(screen.getByLabelText('Add a comment')).toHaveValue('x')
  })

  test('Escape in the box does not throw the draft away', async () => {
    const closePlan = vi.fn()
    open()
    render(<PlanModal />)
    useRoster.setState({ closePlan })
    const user = userEvent.setup()

    const box = await screen.findByLabelText('Add a comment')
    await user.type(box, 'half a thought')
    await user.type(box, '{Escape}')

    // Modal listens for Escape on window; without stopPropagation this closes.
    expect(closePlan).not.toHaveBeenCalled()
    expect(box).toHaveValue('half a thought')
  })
})

describe('approving a plan', () => {
  test('sends it to be built', async () => {
    const api = open(aPlan(), [], {
      approve: vi.fn().mockResolvedValue(aPlan({ status: 'building' })),
    })
    render(<PlanModal />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Approve & build' }))

    await waitFor(() => expect(api.plans.approve).toHaveBeenCalledWith('plan-1'))
  })

  test('warns when the agent cannot report the pull request back', async () => {
    useRoster.setState({
      agents: [anAgent({ id: 'debugging', name: 'Debugging Agent', mcpServers: [] })],
    })
    open()
    render(<PlanModal />)

    // Otherwise the build runs and the link silently never arrives.
    expect(await screen.findByText(/plans.*server/i)).toBeInTheDocument()
  })

  test('says nothing about it when the agent has the server', async () => {
    open()
    render(<PlanModal />)
    await screen.findByRole('heading', { name: 'Steps' })

    expect(screen.queryByText(/plans.*server/i)).not.toBeInTheDocument()
  })
})

describe('a plan that is no longer yours to answer', () => {
  test('says the agent is revising it', async () => {
    open(aPlan({ status: 'revising' }))
    render(<PlanModal />)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Debugging Agent is revising this plan.',
    )
    // Approving twice would be two branches and two pull requests.
    expect(screen.queryByRole('button', { name: 'Approve & build' })).not.toBeInTheDocument()
  })

  test('says the agent is building it', async () => {
    open(aPlan({ status: 'building', branch: 'roster/plan-abc-archive' }))
    render(<PlanModal />)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Debugging Agent is building this plan on roster/plan-abc-archive.',
    )
  })

  test('links to the pull request once there is one', async () => {
    open(aPlan({ status: 'in_review', prUrl: 'https://github.com/o/r/pull/31' }))
    render(<PlanModal />)

    const link = await screen.findByRole('link', { name: /pull request/i })
    expect(link).toHaveAttribute('href', 'https://github.com/o/r/pull/31')
  })
})
