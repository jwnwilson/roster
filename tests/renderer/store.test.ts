import { beforeEach, describe, expect, test } from 'vitest'
import {
  useRoster,
  selectGridAgents,
  selectSidebarAgents,
  selectCurrentAgent,
} from '@/state/store'
import { anAgent, aSession } from './factories'

const INITIAL = useRoster.getState()

beforeEach(() => {
  useRoster.setState(INITIAL, true)
})

const AGENTS = [
  anAgent({ id: 'architect', name: 'Architect Agent' }),
  anAgent({ id: 'debugging', name: 'Debugging Agent' }),
  anAgent({ id: 'review', name: 'Review Agent' }),
]

describe('navigation', () => {
  test('opening an agent switches screen and remembers which agent', () => {
    useRoster.getState().openAgent('debugging')

    expect(useRoster.getState().screen).toBe('agent')
    expect(useRoster.getState().agentId).toBe('debugging')
  })

  test('opening a specific session records it for that agent', () => {
    useRoster.getState().openAgent('debugging', 'session-9')

    expect(useRoster.getState().sess['debugging']).toBe('session-9')
  })

  test('each agent keeps its own selected session across switches', () => {
    const { openAgent } = useRoster.getState()
    openAgent('debugging', 'debug-2')
    openAgent('review', 'review-1')
    openAgent('debugging')

    // Returning to an agent must not lose which session was being viewed.
    expect(useRoster.getState().sess['debugging']).toBe('debug-2')
    expect(useRoster.getState().sess['review']).toBe('review-1')
  })

  test('opening an agent without a session leaves the previous one intact', () => {
    useRoster.getState().openAgent('debugging', 'debug-2')
    useRoster.getState().openAgent('debugging')

    expect(useRoster.getState().sess['debugging']).toBe('debug-2')
  })
})

describe('filtering', () => {
  beforeEach(() => {
    useRoster.setState({ agents: AGENTS })
  })

  test('the sidebar matches on agent name, case-insensitively', () => {
    useRoster.setState({ query: 'REVIEW' })

    expect(selectSidebarAgents(useRoster.getState()).map((a) => a.id)).toEqual(['review'])
  })

  test('an empty sidebar query returns every agent by reference', () => {
    const state = useRoster.getState()
    // Reference equality matters: a fresh array here re-renders forever.
    expect(selectSidebarAgents(state)).toBe(state.agents)
  })

  test('whitespace-only queries are treated as empty', () => {
    useRoster.setState({ query: '   ' })
    expect(selectSidebarAgents(useRoster.getState())).toHaveLength(3)
  })

  test('the grid also matches on session titles', () => {
    useRoster.setState({
      gridQuery: 'leak',
      sessions: { review: [aSession({ agentId: 'review', title: 'Session leak on 504' })] },
    })

    expect(selectGridAgents(useRoster.getState()).map((a) => a.id)).toEqual(['review'])
  })

  test('the grid returns nothing when neither name nor session matches', () => {
    useRoster.setState({ gridQuery: 'nonexistent' })
    expect(selectGridAgents(useRoster.getState())).toEqual([])
  })
})

describe('selectCurrentAgent', () => {
  test('returns null when no agent is open', () => {
    useRoster.setState({ agents: AGENTS })
    expect(selectCurrentAgent(useRoster.getState())).toBeNull()
  })

  test('returns null when the open agent has disappeared from disk', () => {
    useRoster.setState({ agents: AGENTS, agentId: 'deleted-agent' })
    expect(selectCurrentAgent(useRoster.getState())).toBeNull()
  })
})

describe('edit draft', () => {
  beforeEach(() => {
    useRoster.setState({
      agents: [
        anAgent({
          id: 'debugging',
          model: 'claude-opus-5',
          skills: ['repro-harness', 'stack-triage'],
          mcpServers: ['filesystem'],
        }),
      ],
      agentId: 'debugging',
    })
  })

  test('opening snapshots the agent config into the draft', () => {
    useRoster.getState().openEdit()

    expect(useRoster.getState().draft).toEqual({
      runner: 'claude',
      model: 'claude-opus-5',
      systemPrompt: 'Reproduce before you fix.',
      skills: { 'repro-harness': true, 'stack-triage': true },
      mcp: { filesystem: true },
    })
  })

  test('editing the draft does not touch the agent', () => {
    useRoster.getState().openEdit()
    useRoster.getState().patchDraft({ model: 'claude-haiku-4-5' })

    expect(useRoster.getState().draft?.model).toBe('claude-haiku-4-5')
    expect(useRoster.getState().agents[0]?.model).toBe('claude-opus-5')
  })

  test('toggling a skill flips only that skill', () => {
    useRoster.getState().openEdit()
    useRoster.getState().toggleDraftSkill('stack-triage')

    expect(useRoster.getState().draft?.skills).toEqual({
      'repro-harness': true,
      'stack-triage': false,
    })
  })

  test('toggling a skill the agent does not have turns it on', () => {
    useRoster.getState().openEdit()
    useRoster.getState().toggleDraftSkill('adr-writer')

    expect(useRoster.getState().draft?.skills['adr-writer']).toBe(true)
  })

  test('cancelling discards the draft entirely', () => {
    useRoster.getState().openEdit()
    useRoster.getState().patchDraft({ model: 'changed' })
    useRoster.getState().cancelEdit()

    expect(useRoster.getState().editOpen).toBe(false)
    expect(useRoster.getState().draft).toBeNull()
  })

  test('opening for a missing agent does not open the modal', () => {
    useRoster.setState({ agentId: 'ghost' })
    useRoster.getState().openEdit()

    expect(useRoster.getState().editOpen).toBe(false)
  })
})

describe('tool expansion', () => {
  test('each tool call expands independently', () => {
    useRoster.getState().toggleTool('t1')

    expect(useRoster.getState().openTools['t1']).toBe(true)
    expect(useRoster.getState().openTools['t2']).toBeUndefined()
  })

  test('toggling twice collapses again', () => {
    useRoster.getState().toggleTool('t1')
    useRoster.getState().toggleTool('t1')

    expect(useRoster.getState().openTools['t1']).toBe(false)
  })
})
