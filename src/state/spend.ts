/**
 * What the roster has cost, shaped for the Spend screen's three bar charts.
 *
 * Pure functions over store state, so the arithmetic is testable without
 * rendering anything. Each returns fresh arrays — call them inside useMemo,
 * never through `useRoster(selector)`, which loops on new references.
 *
 * Per-agent and per-project totals are summed in SQL (UsageStore); provider
 * and model are folded here, because neither is recorded against a session.
 * They come from the agent's *current* configuration, so changing an agent's
 * model re-labels what it has already spent — the same trade the design
 * handoff's prototype makes.
 */

import { statusColor } from '@shared/status'
import { NO_PROJECT } from '@shared/types'
import { formatCost } from './format'
import { agentStatus, type RosterState } from './store'

/** Below this a bar is invisible, so a real cost would read as none at all. */
const MIN_PCT = 2

/** Providers and their models, per the handoff's Spend palette. */
const PROVIDER_COLOR = 'var(--color-accent)'
const MODEL_COLOR = 'var(--color-accent-light)'
const NO_PROJECT_COLOR = 'var(--color-faint-2)'

/** What an agent's runner is called when no installed runner claims it. */
const CUSTOM_PROVIDER = 'Custom'

export interface SpendInput {
  key: string
  label: string
  value: number
  color: string
}

export interface SpendBar extends SpendInput {
  /** Width as a percentage of the group's largest bar. */
  pct: number
  formatted: string
  /** Only on provider rows: that provider's models, scaled within it. */
  models?: SpendBar[]
}

/**
 * Size a group of rows against its own largest value, biggest first.
 *
 * A row worth nothing gets no bar rather than the minimum one: the floor is
 * there to keep small real costs visible, and stretching it to cover zero
 * would draw spend that never happened.
 */
export function spendBars(rows: readonly SpendInput[]): SpendBar[] {
  const max = Math.max(0, ...rows.map((row) => row.value))

  return [...rows]
    // Ties break by key so equal costs hold their order between renders.
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
    .map((row) => ({
      ...row,
      pct: max <= 0 || row.value <= 0 ? 0 : Math.max(MIN_PCT, (row.value / max) * 100),
      formatted: formatCost(row.value),
    }))
}

/** Add up costs under a key, keeping insertion order. */
function totalBy<T>(items: readonly T[], keyOf: (item: T) => string, costOf: (item: T) => number) {
  const totals = new Map<string, number>()
  for (const item of items) {
    const key = keyOf(item)
    totals.set(key, (totals.get(key) ?? 0) + costOf(item))
  }
  return totals
}

/** Only agents that have actually run — a never-used agent is not a $0 bar. */
function agentsWithSpend(state: RosterState) {
  return state.agents.flatMap((agent) => {
    const usage = state.agentUsage[agent.id]
    return usage ? [{ agent, costUsd: usage.costUsd }] : []
  })
}

/**
 * The provider label an agent's runner presents.
 *
 * Falls back to "Custom" for a runner Roster cannot see — a bring-your-own
 * CLI, or one that is configured but not installed.
 */
function providerOf(state: RosterState, runner: string): string {
  return state.runners.find((candidate) => candidate.id === runner)?.provider ?? CUSTOM_PROVIDER
}

/** One bar per provider, each carrying its own models as sub-bars. */
export function selectSpendByProvider(state: RosterState): SpendBar[] {
  const spending = agentsWithSpend(state)
  const totals = totalBy(
    spending,
    ({ agent }) => providerOf(state, agent.runner),
    ({ costUsd }) => costUsd,
  )

  const providers = spendBars(
    [...totals].map(([provider, value]) => ({
      key: provider,
      label: provider,
      value,
      color: PROVIDER_COLOR,
    })),
  )

  return providers.map((provider) => {
    const models = totalBy(
      spending.filter(({ agent }) => providerOf(state, agent.runner) === provider.key),
      ({ agent }) => agent.model,
      ({ costUsd }) => costUsd,
    )

    return {
      ...provider,
      // Scaled within this provider, so its own split reads clearly whatever
      // the rest of the roster spent.
      models: spendBars(
        [...models].map(([model, value]) => ({
          key: model,
          label: model,
          value,
          color: MODEL_COLOR,
        })),
      ),
    }
  })
}

/** One bar per agent, coloured by the status its dot shows. */
export function selectSpendByAgent(state: RosterState): SpendBar[] {
  return spendBars(
    agentsWithSpend(state).map(({ agent, costUsd }) => ({
      key: agent.id,
      label: agent.name,
      value: costUsd,
      color: statusColor(agentStatus(state, agent)),
    })),
  )
}

/**
 * One bar per project, plus a bucket for sessions nobody assigned.
 *
 * A project deleted since its sessions ran no longer resolves, so its spend
 * joins the unassigned bucket rather than showing an id nobody recognises.
 */
export function selectSpendByProject(state: RosterState): SpendBar[] {
  return spendBars(
    Object.entries(state.spendByProject).map(([id, usage]) => {
      const project = id === NO_PROJECT ? null : (state.projects.find((p) => p.id === id) ?? null)

      return {
        key: id,
        label: project?.name ?? 'No project',
        value: usage.costUsd,
        color: project?.color ?? NO_PROJECT_COLOR,
      }
    }),
  )
}

/**
 * What the whole roster has run up — the figure the Spend header, the
 * sidebar's nav meta, and the grid's status bar all quote.
 */
export function selectRosterTotals(state: RosterState): { tokens: number; costUsd: number } {
  return Object.values(state.agentUsage).reduce(
    (sum, usage) => ({
      tokens: sum.tokens + usage.tokens,
      costUsd: sum.costUsd + usage.costUsd,
    }),
    { tokens: 0, costUsd: 0 },
  )
}
