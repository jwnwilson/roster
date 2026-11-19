import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Sidebar } from '@/components/Sidebar'
import { useRoster } from '@/state/store'
import type { SessionSearchHit } from '@shared/types'
import { MATCH_CLOSE, MATCH_OPEN } from '@shared/search'
import { anAgent, aSession } from './factories'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()
const IMPLEMENTER = anAgent({ id: 'implementer', name: 'Implementer' })

function hit(overrides: Partial<SessionSearchHit> = {}): SessionSearchHit {
  return {
    sessionId: 's1',
    agentId: 'implementer',
    label: 'Kettle descale',
    snippet: `fill with white ${MATCH_OPEN}vinegar${MATCH_CLOSE} and boil`,
    matches: 2,
    lastMatchAt: 1_700_000_000_000,
    archived: false,
    ...overrides,
  }
}

const SEARCH_BOX = /Search agents and sessions/

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  installRosterApi()
  useRoster.setState({ agents: [IMPLEMENTER], loaded: true, sessions: {}, screen: 'grid' })
})

async function typeQuery(text: string): Promise<void> {
  await userEvent.type(screen.getByRole('textbox', { name: SEARCH_BOX }), text)
}

describe('the transcript matches group', () => {
  test('appears under the search box with the matched word marked in its snippet', async () => {
    const search = vi.fn().mockResolvedValue([hit()])
    installRosterApi({ sessions: { search } })
    render(<Sidebar />)

    await typeQuery('vinegar')

    expect(await screen.findByText('Matching transcripts')).toBeInTheDocument()
    await waitFor(() => expect(search).toHaveBeenLastCalledWith('vinegar', { includeArchived: false }))
    const row = await screen.findByRole('button', { name: /Kettle descale/ })
    expect(row).toHaveTextContent('Implementer')
    expect(row.querySelector('mark')).toHaveTextContent('vinegar')
  })

  test('shows nothing for an empty query, and asks the main process nothing', async () => {
    const search = vi.fn().mockResolvedValue([])
    installRosterApi({ sessions: { search } })
    render(<Sidebar />)

    await typeQuery('   ')

    expect(screen.queryByText('Matching transcripts')).not.toBeInTheDocument()
    expect(search).not.toHaveBeenCalled()
  })

  test('says so when no transcript matches', async () => {
    installRosterApi({ sessions: { search: vi.fn().mockResolvedValue([]) } })
    render(<Sidebar />)

    await typeQuery('zeppelin')

    expect(await screen.findByText('No transcripts match.')).toBeInTheDocument()
  })

  test('opens the session a match is in', async () => {
    installRosterApi({ sessions: { search: vi.fn().mockResolvedValue([hit({ sessionId: 's1' })]) } })
    render(<Sidebar />)
    await typeQuery('vinegar')

    await userEvent.click(await screen.findByRole('button', { name: /Kettle descale/ }))

    expect(useRoster.getState().screen).toBe('agent')
    expect(useRoster.getState().agentId).toBe('implementer')
    expect(useRoster.getState().sess['implementer']).toBe('s1')
  })

  test('leaves archived sessions out until the archived toggle is on', async () => {
    const search = vi.fn().mockResolvedValue([])
    installRosterApi({ sessions: { search } })
    render(<Sidebar />)
    await typeQuery('vinegar')
    await waitFor(() => expect(search).toHaveBeenCalledWith('vinegar', { includeArchived: false }))

    await userEvent.click(screen.getByRole('checkbox', { name: 'Include archived' }))

    await waitFor(() => expect(search).toHaveBeenLastCalledWith('vinegar', { includeArchived: true }))
  })

  test('an archived match is marked as archived and opens the archived view', async () => {
    installRosterApi({
      sessions: {
        search: vi.fn().mockResolvedValue([hit({ sessionId: 's9', label: 'Old kettle', archived: true })]),
      },
    })
    render(<Sidebar />)
    await typeQuery('vinegar')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include archived' }))

    const row = await screen.findByRole('button', { name: /Old kettle/ })
    expect(row).toHaveTextContent('archived')
    await userEvent.click(row)

    expect(useRoster.getState().screen).toBe('archived')
  })

  test('the name match on the rail still works beside the transcript group', async () => {
    useRoster.setState({ sessions: { implementer: [aSession({ id: 's2', title: 'Kettle chat', agentId: 'implementer' })] } })
    installRosterApi({ sessions: { search: vi.fn().mockResolvedValue([]) } })
    render(<Sidebar />)

    await typeQuery('kettle')

    expect(screen.getByRole('button', { name: /^Implementer/ })).toBeInTheDocument()
  })
})
