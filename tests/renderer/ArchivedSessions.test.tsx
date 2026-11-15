import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ArchivedSessions } from '@/screens/ArchivedSessions'
import { useRoster } from '@/state/store'
import type { Session } from '@shared/types'
import { anAgent, aSession } from './factories'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()

const DEBUGGING = anAgent({ id: 'debugging', name: 'Debugging Agent' })
const REVIEW = anAgent({ id: 'review', name: 'Review Agent' })

function archived(overrides: Partial<Session> = {}): Session {
  return aSession({ archivedAt: 1_700_000_500_000, ...overrides })
}

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  installRosterApi()
  useRoster.setState({ agents: [DEBUGGING, REVIEW], loaded: true, screen: 'archived' })
})

describe('ArchivedSessions', () => {
  test('lists archived sessions with the agent each belonged to', async () => {
    installRosterApi({
      sessions: {
        listArchived: vi.fn().mockResolvedValue([
          archived({ id: 's1', title: 'Old fix', agentId: 'debugging' }),
          archived({ id: 's2', title: 'Old review', agentId: 'review' }),
        ]),
      },
    })
    render(<ArchivedSessions />)

    const first = await screen.findByRole('listitem', { name: /Old fix/ })
    expect(first).toHaveTextContent('Debugging Agent')
    expect(screen.getByRole('listitem', { name: /Old review/ })).toHaveTextContent('Review Agent')
  })

  test('says so when nothing is archived', async () => {
    render(<ArchivedSessions />)

    expect(await screen.findByText('Nothing is archived.')).toBeInTheDocument()
  })

  test('restores a session, which leaves this list and returns to its agent', async () => {
    const user = userEvent.setup()
    const restore = vi.fn().mockResolvedValue(aSession({ id: 's1', agentId: 'debugging' }))
    installRosterApi({
      sessions: {
        listArchived: vi.fn().mockResolvedValue([archived({ id: 's1', title: 'Old fix' })]),
        restore,
      },
    })
    render(<ArchivedSessions />)

    await user.click(await screen.findByRole('button', { name: 'Restore session Old fix' }))

    expect(restore).toHaveBeenCalledWith('s1')
    await waitFor(() => expect(screen.queryByRole('listitem', { name: /Old fix/ })).not.toBeInTheDocument())
    expect(await screen.findByText('Nothing is archived.')).toBeInTheDocument()
  })

  test('deletes permanently only after the confirmation, which says it cannot be undone', async () => {
    const user = userEvent.setup()
    const remove = vi.fn().mockResolvedValue(true)
    installRosterApi({
      sessions: {
        listArchived: vi.fn().mockResolvedValue([archived({ id: 's1', title: 'Old fix' })]),
        remove,
      },
    })
    render(<ArchivedSessions />)

    await user.click(await screen.findByRole('button', { name: 'Delete session Old fix permanently' }))

    expect(remove).toHaveBeenCalledWith('s1')
    await waitFor(() => expect(screen.queryByRole('listitem', { name: /Old fix/ })).not.toBeInTheDocument())
  })

  test('a dismissed confirmation keeps the session listed', async () => {
    const user = userEvent.setup()
    installRosterApi({
      sessions: {
        listArchived: vi.fn().mockResolvedValue([archived({ id: 's1', title: 'Old fix' })]),
        remove: vi.fn().mockResolvedValue(false),
      },
    })
    render(<ArchivedSessions />)

    await user.click(await screen.findByRole('button', { name: 'Delete session Old fix permanently' }))

    await waitFor(() => expect(screen.getByRole('listitem', { name: /Old fix/ })).toBeInTheDocument())
  })

  test('says why when a restore fails', async () => {
    const user = userEvent.setup()
    installRosterApi({
      sessions: {
        listArchived: vi.fn().mockResolvedValue([archived({ id: 's1', title: 'Old fix' })]),
        restore: vi.fn().mockRejectedValue(new Error('database is locked')),
      },
    })
    render(<ArchivedSessions />)

    await user.click(await screen.findByRole('button', { name: 'Restore session Old fix' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('database is locked')
  })
})

describe('the sidebar entry for archived sessions', () => {
  test('opens the archived view from the rail', async () => {
    const { Sidebar } = await import('@/components/Sidebar')
    useRoster.setState({ screen: 'grid' })
    render(<Sidebar />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /Archived/ }))

    expect(useRoster.getState().screen).toBe('archived')
  })
})

describe('ArchivedSessions staying current', () => {
  test('an agent archiving a session while this view is open adds it without a reload', async () => {
    let emit: ((event: { type: string; sessionId: string; agentId: string }) => void) | undefined
    const listArchived = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([archived({ id: 's7', title: 'Put away by an agent' })])
    installRosterApi({
      sessions: {
        listArchived,
        onEvent: vi.fn((handler) => {
          emit = handler
          return () => {}
        }),
      },
    })
    render(<ArchivedSessions />)
    expect(await screen.findByText('Nothing is archived.')).toBeInTheDocument()

    emit?.({ type: 'session-archived', sessionId: 's7', agentId: 'debugging' })

    expect(await screen.findByRole('listitem', { name: /Put away by an agent/ })).toBeInTheDocument()
  })
})
