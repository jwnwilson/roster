import { beforeEach, describe, expect, test } from 'vitest'
import {
  selectRosterTotals,
  selectSpendByAgent,
  selectSpendByProject,
  selectSpendByProvider,
  spendBars,
} from '@/state/spend'
import { useRoster } from '@/state/store'
import { NO_PROJECT } from '@shared/types'
import { anAgent, aProject, aRunner, aSession } from './factories'

const INITIAL = useRoster.getState()

beforeEach(() => {
  useRoster.setState(INITIAL, true)
})

/* ------------------------------------------------------------------ bars */

describe('spendBars', () => {
  test('sorts descending so the largest cost reads first', () => {
    const bars = spendBars([
      { key: 'a', label: 'A', value: 1, color: 'red' },
      { key: 'b', label: 'B', value: 9, color: 'red' },
      { key: 'c', label: 'C', value: 5, color: 'red' },
    ])

    expect(bars.map((bar) => bar.key)).toEqual(['b', 'c', 'a'])
  })

  test('breaks ties by key, so equal spends do not reorder between renders', () => {
    const bars = spendBars([
      { key: 'zebra', label: 'Z', value: 2, color: 'red' },
      { key: 'ant', label: 'A', value: 2, color: 'red' },
    ])

    expect(bars.map((bar) => bar.key)).toEqual(['ant', 'zebra'])
  })

  test('scales each bar against the group its own max', () => {
    const bars = spendBars([
      { key: 'a', label: 'A', value: 10, color: 'red' },
      { key: 'b', label: 'B', value: 5, color: 'red' },
    ])

    expect(bars[0]?.pct).toBe(100)
    expect(bars[1]?.pct).toBe(50)
  })

  test('floors a tiny-but-nonzero bar so it stays visible', () => {
    const bars = spendBars([
      { key: 'big', label: 'Big', value: 100, color: 'red' },
      { key: 'tiny', label: 'Tiny', value: 0.01, color: 'red' },
    ])

    expect(bars[1]?.pct).toBe(2)
  })

  test('a group with nothing spent draws no bars rather than dividing by zero', () => {
    const bars = spendBars([
      { key: 'a', label: 'A', value: 0, color: 'red' },
      { key: 'b', label: 'B', value: 0, color: 'red' },
    ])

    expect(bars.map((bar) => bar.pct)).toEqual([0, 0])
  })

  test('formats a zero-cost row as $0.00 — the runner reported nothing, not free', () => {
    const bars = spendBars([{ key: 'a', label: 'A', value: 0, color: 'red' }])

    expect(bars[0]?.formatted).toBe('$0.00')
  })

  test('does not reorder the array it was given', () => {
    const rows = [
      { key: 'a', label: 'A', value: 1, color: 'red' },
      { key: 'b', label: 'B', value: 9, color: 'red' },
    ]
    spendBars(rows)

    expect(rows.map((row) => row.key)).toEqual(['a', 'b'])
  })

  test('has no bars at all when given no rows', () => {
    expect(spendBars([])).toEqual([])
  })
})

/* -------------------------------------------------------------- provider */

describe('selectSpendByProvider', () => {
  test('sums every agent on a provider into one bar', () => {
    useRoster.setState({
      runners: [aRunner({ id: 'claude', provider: 'Anthropic' })],
      agents: [
        anAgent({ id: 'debugging', runner: 'claude', model: 'claude-opus-5' }),
        anAgent({ id: 'review', runner: 'claude', model: 'claude-opus-5' }),
      ],
      agentUsage: {
        debugging: { tokens: 10, costUsd: 1 },
        review: { tokens: 10, costUsd: 2 },
      },
    })

    const bars = selectSpendByProvider(useRoster.getState())

    expect(bars).toHaveLength(1)
    expect(bars[0]?.label).toBe('Anthropic')
    expect(bars[0]?.formatted).toBe('$3.00')
  })

  test('nests each provider its own models', () => {
    useRoster.setState({
      runners: [aRunner({ id: 'claude', provider: 'Anthropic' })],
      agents: [
        anAgent({ id: 'debugging', runner: 'claude', model: 'claude-opus-5' }),
        anAgent({ id: 'review', runner: 'claude', model: 'claude-haiku-4-5' }),
      ],
      agentUsage: {
        debugging: { tokens: 10, costUsd: 3 },
        review: { tokens: 10, costUsd: 1 },
      },
    })

    const models = selectSpendByProvider(useRoster.getState())[0]?.models

    expect(models?.map((model) => model.label)).toEqual(['claude-opus-5', 'claude-haiku-4-5'])
    expect(models?.map((model) => model.formatted)).toEqual(['$3.00', '$1.00'])
  })

  test('folds two agents on the same model into one model bar', () => {
    useRoster.setState({
      runners: [aRunner({ id: 'claude', provider: 'Anthropic' })],
      agents: [
        anAgent({ id: 'debugging', runner: 'claude', model: 'claude-opus-5' }),
        anAgent({ id: 'review', runner: 'claude', model: 'claude-opus-5' }),
      ],
      agentUsage: {
        debugging: { tokens: 10, costUsd: 1 },
        review: { tokens: 10, costUsd: 2 },
      },
    })

    const models = selectSpendByProvider(useRoster.getState())[0]?.models

    expect(models).toHaveLength(1)
    expect(models?.[0]?.formatted).toBe('$3.00')
  })

  test('scales model sub-bars within their provider, not across the roster', () => {
    useRoster.setState({
      runners: [
        aRunner({ id: 'claude', provider: 'Anthropic' }),
        aRunner({ id: 'codex', provider: 'OpenAI' }),
      ],
      agents: [
        anAgent({ id: 'debugging', runner: 'claude', model: 'claude-opus-5' }),
        anAgent({ id: 'review', runner: 'codex', model: 'gpt-5.5' }),
      ],
      agentUsage: {
        debugging: { tokens: 10, costUsd: 10 },
        review: { tokens: 10, costUsd: 1 },
      },
    })

    const bars = selectSpendByProvider(useRoster.getState())
    const openai = bars.find((bar) => bar.label === 'OpenAI')

    // The provider bar is a tenth of Anthropic's, but its only model fills it.
    expect(openai?.pct).toBe(10)
    expect(openai?.models?.[0]?.pct).toBe(100)
  })

  test('keeps a provider whose runner reported no cost, showing $0.00', () => {
    useRoster.setState({
      runners: [aRunner({ id: 'codex', provider: 'OpenAI' })],
      agents: [anAgent({ id: 'review', runner: 'codex', model: 'gpt-5.5' })],
      agentUsage: { review: { tokens: 118_400, costUsd: 0 } },
    })

    const bars = selectSpendByProvider(useRoster.getState())

    expect(bars[0]?.label).toBe('OpenAI')
    expect(bars[0]?.formatted).toBe('$0.00')
  })

  test('files an agent whose runner is not installed under Custom', () => {
    useRoster.setState({
      runners: [],
      agents: [anAgent({ id: 'debugging', runner: 'my-cli', model: 'whatever' })],
      agentUsage: { debugging: { tokens: 10, costUsd: 1 } },
    })

    expect(selectSpendByProvider(useRoster.getState())[0]?.label).toBe('Custom')
  })

  test('leaves out an agent that has never run', () => {
    useRoster.setState({
      runners: [aRunner()],
      agents: [anAgent({ id: 'debugging' })],
      agentUsage: {},
    })

    expect(selectSpendByProvider(useRoster.getState())).toEqual([])
  })
})

/* ----------------------------------------------------------------- agent */

describe('selectSpendByAgent', () => {
  test('gives one bar per agent, named and costed', () => {
    useRoster.setState({
      agents: [
        anAgent({ id: 'debugging', name: 'Debugging Agent' }),
        anAgent({ id: 'review', name: 'Review Agent' }),
      ],
      agentUsage: {
        debugging: { tokens: 10, costUsd: 1.24 },
        review: { tokens: 10, costUsd: 0.48 },
      },
    })

    const bars = selectSpendByAgent(useRoster.getState())

    expect(bars.map((bar) => bar.label)).toEqual(['Debugging Agent', 'Review Agent'])
    expect(bars.map((bar) => bar.formatted)).toEqual(['$1.24', '$0.48'])
  })

  test('colours the bar by the status its dot shows', () => {
    useRoster.setState({
      agents: [anAgent({ id: 'debugging', status: 'idle' })],
      sessions: { debugging: [aSession({ id: 'session-1', status: 'approval' })] },
      agentUsage: { debugging: { tokens: 10, costUsd: 1 } },
    })

    expect(selectSpendByAgent(useRoster.getState())[0]?.color).toBe('var(--color-amber)')
  })

  test('leaves out an agent that has never run', () => {
    useRoster.setState({ agents: [anAgent()], agentUsage: {} })

    expect(selectSpendByAgent(useRoster.getState())).toEqual([])
  })
})

/* --------------------------------------------------------------- project */

describe('selectSpendByProject', () => {
  test('names each project and takes its swatch colour', () => {
    useRoster.setState({
      projects: [aProject({ id: 'api', name: 'API reliability', color: 'var(--color-project-4)' })],
      spendByProject: { api: { tokens: 10, costUsd: 1.31 } },
    })

    const bars = selectSpendByProject(useRoster.getState())

    expect(bars[0]?.label).toBe('API reliability')
    expect(bars[0]?.color).toBe('var(--color-project-4)')
    expect(bars[0]?.formatted).toBe('$1.31')
  })

  test('labels the unassigned bucket "No project"', () => {
    useRoster.setState({
      projects: [],
      spendByProject: { [NO_PROJECT]: { tokens: 10, costUsd: 0.06 } },
    })

    const bars = selectSpendByProject(useRoster.getState())

    expect(bars[0]?.label).toBe('No project')
    expect(bars[0]?.color).toBe('var(--color-faint-2)')
  })

  test('falls back to No project when a deleted project no longer resolves', () => {
    useRoster.setState({
      projects: [],
      spendByProject: { 'gone-away': { tokens: 10, costUsd: 1 } },
    })

    expect(selectSpendByProject(useRoster.getState())[0]?.label).toBe('No project')
  })
})

/* ---------------------------------------------------------------- totals */

describe('selectRosterTotals', () => {
  test('sums tokens and cost across every agent', () => {
    useRoster.setState({
      agentUsage: {
        debugging: { tokens: 800, costUsd: 1.24 },
        review: { tokens: 200, costUsd: 0.48 },
      },
    })

    expect(selectRosterTotals(useRoster.getState())).toEqual({ tokens: 1_000, costUsd: 1.72 })
  })

  test('is zero before anything has run', () => {
    expect(selectRosterTotals(useRoster.getState())).toEqual({ tokens: 0, costUsd: 0 })
  })
})
