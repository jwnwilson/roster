import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SessionEventPayload } from '@shared/ipc'
import { App } from '@/App'
import { useRoster } from '@/state/store'
import { anAgent, aRunner, aSkill, anMcpServer } from './factories'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()

// The terminal needs a real canvas; it is verified live instead.
vi.mock('@/terminal/TerminalPane', () => ({
  TerminalPane: () => <div data-testid="terminal-pane" />,
}))

const AGENTS = [anAgent({ id: 'debugging', name: 'Debugging Agent' })]

function loadedApi(overrides: Parameters<typeof installRosterApi>[0] = {}) {
  return installRosterApi({
    agents: { list: vi.fn().mockResolvedValue(AGENTS) },
    runners: { list: vi.fn().mockResolvedValue([aRunner()]) },
    skills: { list: vi.fn().mockResolvedValue([aSkill()]) },
    mcp: { list: vi.fn().mockResolvedValue([anMcpServer()]) },
    ...overrides,
  })
}

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  loadedApi()
})

describe('App — startup', () => {
  test('shows a loading state until the first read returns', () => {
    render(<App />)
    expect(screen.getByText('Loading roster…')).toBeInTheDocument()
  })

  test('hydrates every store from the bridge in one pass', async () => {
    render(<App />)

    await waitFor(() => expect(useRoster.getState().loaded).toBe(true))
    expect(useRoster.getState().agents).toHaveLength(1)
    expect(useRoster.getState().skills).toHaveLength(1)
    expect(useRoster.getState().mcpServers).toHaveLength(1)
    expect(useRoster.getState().runners).toHaveLength(1)
  })

  test('lands on the Agents grid', async () => {
    render(<App />)
    expect(await screen.findByText(/configured/)).toBeInTheDocument()
  })
})

describe('App — routing', () => {
  test.each([
    ['Skills', /~\/roster\/skills/],
    ['MCP servers', /Installed/],
  ])('navigates to %s', async (label, marker) => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/configured/)

    await user.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }))

    expect(await screen.findByText(marker)).toBeInTheDocument()
  })

  test('opens an agent from the sidebar', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/configured/)

    await user.click(screen.getAllByText('Debugging Agent')[0]!)

    expect(useRoster.getState().screen).toBe('agent')
  })
})

describe('App — live subscriptions', () => {
  test('reflects an agent.toml edited outside Roster', async () => {
    let push: ((agents: typeof AGENTS) => void) | undefined
    loadedApi({
      agents: {
        list: vi.fn().mockResolvedValue(AGENTS),
        onChanged: vi.fn((listener: (agents: typeof AGENTS) => void) => {
          push = listener
          return () => {}
        }),
      },
    })
    render(<App />)
    await screen.findByText(/configured/)

    // The push comes from outside React's event system, so it needs act().
    act(() => push?.([anAgent({ id: 'debugging', name: 'Renamed By Hand' })]))

    // Appears in both the sidebar list and the grid card.
    expect((await screen.findAllByText('Renamed By Hand')).length).toBeGreaterThan(0)
  })

  test('applies a live turn event to the store', async () => {
    let push: ((event: SessionEventPayload) => void) | undefined
    loadedApi({
      sessions: {
        onEvent: vi.fn((listener: (event: SessionEventPayload) => void) => {
          push = listener
          return () => {}
        }),
      },
    })
    render(<App />)
    await screen.findByText(/configured/)

    act(() => push?.({ type: 'streaming', sessionId: 's1', active: true }))

    await waitFor(() => expect(useRoster.getState().streaming['s1']).toBe(true))
  })

  test('unsubscribes on unmount, so a closed window stops receiving events', async () => {
    const stopAgents = vi.fn()
    const stopSessions = vi.fn()
    loadedApi({
      agents: { list: vi.fn().mockResolvedValue(AGENTS), onChanged: vi.fn(() => stopAgents) },
      sessions: { onEvent: vi.fn(() => stopSessions) },
    })

    const { unmount } = render(<App />)
    await screen.findByText(/configured/)
    unmount()

    expect(stopAgents).toHaveBeenCalled()
    expect(stopSessions).toHaveBeenCalled()
  })
})

describe('App — agent spend totals', () => {
  test('loads them alongside everything else at startup', async () => {
    loadedApi({
      sessions: {
        usageByAgent: vi.fn().mockResolvedValue({ debugging: { tokens: 900, costUsd: 0.5 } }),
      },
    })
    render(<App />)

    await waitFor(() =>
      expect(useRoster.getState().agentUsage['debugging']).toEqual({
        tokens: 900,
        costUsd: 0.5,
      }),
    )
  })

  test('re-reads them when a turn reports usage', async () => {
    let emit: ((event: SessionEventPayload) => void) | null = null
    const usageByAgent = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValue({ debugging: { tokens: 77_913, costUsd: 0.94 } })

    loadedApi({
      sessions: {
        usageByAgent,
        onEvent: vi.fn().mockImplementation((listener) => {
          emit = listener
          return () => {}
        }),
      },
    })
    render(<App />)
    await waitFor(() => expect(useRoster.getState().loaded).toBe(true))

    // Totals are a SQL sum across every session, so one session's event
    // cannot be folded in locally — the renderer has to ask again.
    act(() =>
      emit?.({
        type: 'usage',
        sessionId: 's1',
        usage: {
          sessionId: 's1',
          inputTokens: 18,
          outputTokens: 297,
          totalTokens: 77_913,
          costUsd: 0.94,
          contextUsed: 0.08,
        },
      }),
    )

    await waitFor(() =>
      expect(useRoster.getState().agentUsage['debugging']?.tokens).toBe(77_913),
    )
  })
})
