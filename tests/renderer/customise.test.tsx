import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Customisation } from '@shared/types'
import { App } from '@/App'
import { Sidebar } from '@/components/Sidebar'
import { Customise } from '@/screens/Customise'
import { useRoster } from '@/state/store'
import { anAgent } from './factories'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()

function aCopy(overrides: Partial<Customisation> = {}): Customisation {
  return {
    id: 'c1',
    name: 'Fork',
    path: '/Users/me/roster/customisations/c1',
    pathLabel: '~/roster/customisations/c1',
    forkRemote: null,
    baseSha: 'a'.repeat(40),
    rosterHome: '/Users/me/roster/customisations/c1/home',
    devPort: 5180,
    status: 'ready',
    error: null,
    progress: null,
    acknowledgedAt: 1,
    createdAt: 1,
    ...overrides,
  }
}

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  installRosterApi()
})

describe('Customise screen', () => {
  test('shows the warning above the form, before anything can be created', () => {
    render(<Customise />)
    const warning = screen.getByRole('note', { name: /before you create a copy/i })
    expect(within(warning).getByText(/separate copy of Roster/)).toBeInTheDocument()
    expect(within(warning).getByText(/will not receive updates from official releases/)).toBeInTheDocument()
    expect(within(warning).getByText(/You are responsible for maintaining your changes/)).toBeInTheDocument()
    expect(within(warning).getByText(/The official app is not affected/)).toBeInTheDocument()
  })

  test('Create copy stays disabled until a name is given and the warning is acknowledged', async () => {
    const user = userEvent.setup()
    render(<Customise />)
    const create = screen.getByRole('button', { name: 'Create copy' })
    expect(create).toBeDisabled()

    await user.type(screen.getByLabelText('Copy name'), 'Fork')
    expect(create).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /I understand/ }))
    expect(create).toBeEnabled()

    await user.clear(screen.getByLabelText('Copy name'))
    expect(create).toBeDisabled()
  })

  test('creating a copy sends the acknowledgement and lists the copy as it is set up', async () => {
    const user = userEvent.setup()
    const copy = aCopy({ status: 'provisioning', progress: 'Cloning Roster main…' })
    const api = installRosterApi({ customisations: { create: vi.fn().mockResolvedValue(copy) } })
    render(<Customise />)

    await user.type(screen.getByLabelText('Copy name'), 'Fork')
    await user.type(screen.getByLabelText(/Fork URL/), 'https://github.com/me/roster.git')
    await user.click(screen.getByRole('checkbox', { name: /I understand/ }))
    await user.click(screen.getByRole('button', { name: 'Create copy' }))

    expect(api.customisations.create).toHaveBeenCalledWith({
      name: 'Fork',
      forkUrl: 'https://github.com/me/roster.git',
      acknowledged: true,
    })
    // A new copy opens straight into its own view, where its setup shows.
    expect(await screen.findByText(/Setting up/)).toBeInTheDocument()
    expect(screen.getByText('Cloning Roster main…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to copies' })).toBeInTheDocument()
  })

  test('a refused create shows the reason and keeps what was typed', async () => {
    const user = userEvent.setup()
    installRosterApi({
      customisations: {
        create: vi.fn().mockRejectedValue(new Error('The fork must be a git URL.')),
      },
    })
    render(<Customise />)
    await user.type(screen.getByLabelText('Copy name'), 'Fork')
    await user.click(screen.getByRole('checkbox', { name: /I understand/ }))
    await user.click(screen.getByRole('button', { name: 'Create copy' }))

    expect(await screen.findByText('The fork must be a git URL.')).toBeInTheDocument()
    expect(screen.getByLabelText('Copy name')).toHaveValue('Fork')
  })

  test('each copy shows its status, port and fork, and Manage opens its view', async () => {
    const user = userEvent.setup()
    useRoster.setState({
      customisations: [aCopy({ forkRemote: 'https://github.com/me/roster.git', devPort: 5181 })],
    })
    render(<Customise />)

    const list = screen.getByRole('list', { name: 'Your copies' })
    expect(within(list).getByText(/Ready · port 5181/)).toBeInTheDocument()
    expect(within(list).getByText(/5181/)).toBeInTheDocument()
    expect(within(list).getByText(/https:\/\/github\.com\/me\/roster\.git/)).toBeInTheDocument()

    await user.click(within(list).getByRole('button', { name: 'Manage Fork' }))
    expect(screen.getByText(/Dev port/)).toBeInTheDocument()
    expect(screen.getByText(/aaaaaaa/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to copies' })).toBeInTheDocument()
  })

  test('a failed copy shows its error and offers a retry', async () => {
    const user = userEvent.setup()
    const retry = vi.fn().mockResolvedValue(aCopy({ status: 'provisioning' }))
    installRosterApi({ customisations: { retry } })
    useRoster.setState({ customisations: [aCopy({ status: 'failed', error: 'npm install failed' })] })
    render(<Customise />)

    await user.click(screen.getByRole('button', { name: 'Manage Fork' }))
    expect(screen.getByText('npm install failed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry setup' }))
    expect(retry).toHaveBeenCalledWith('c1')
  })
})

describe('Customise navigation', () => {
  test('a Customise row sits directly below Spend and counts existing copies', () => {
    useRoster.setState({ agents: [anAgent()], customisations: [aCopy(), aCopy({ id: 'c2' })] })
    render(<Sidebar />)
    const nav = screen.getByRole('navigation')
    const labels = within(nav).getAllByRole('button').map((b) => b.textContent ?? '')
    const spend = labels.findIndex((text) => text.startsWith('Spend'))
    expect(labels[spend + 1]).toMatch(/^Customise/)
    expect(within(nav).getByRole('button', { name: /^Customise/ })).toHaveTextContent('2')
  })

  test('the row opens the Customise screen from anywhere', async () => {
    const user = userEvent.setup()
    installRosterApi({
      agents: { list: vi.fn().mockResolvedValue([anAgent({ id: 'a', name: 'Debugging Agent' })]) },
    })
    render(<App />)
    await screen.findByText(/configured/)
    await user.click(screen.getByRole('button', { name: /^Customise/ }))
    expect(useRoster.getState().screen).toBe('customise')
    expect(await screen.findByText(/before you create a copy/i)).toBeInTheDocument()
  })
})

test('the copy list is kept current by the main process', async () => {
  let push: ((copies: Customisation[]) => void) | undefined
  installRosterApi({
    customisations: {
      onChanged: vi.fn((listener) => {
        push = listener
        return () => {}
      }),
    },
  })
  render(<App />)
  await waitFor(() => expect(useRoster.getState().loaded).toBe(true))
  fireEvent.click(screen.getByRole('button', { name: /^Customise/ }))
  push?.([aCopy({ name: 'Pushed' })])
  expect(await screen.findByText('Pushed')).toBeInTheDocument()
})
