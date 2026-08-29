import { useMemo } from 'react'
import { ScreenHeader, SectionLabel } from '@/components/primitives'
import { formatCost } from '@/state/format'
import {
  selectRosterTotals,
  selectSpendByAgent,
  selectSpendByProject,
  selectSpendByProvider,
  type SpendBar,
} from '@/state/spend'
import { useRoster } from '@/state/store'

/**
 * Cost across the roster, grouped three ways.
 *
 * Deliberately unfiltered: the app-wide project filter narrows the board and
 * the grid, but Spend is a whole-roster view and its By-project chart already
 * is the breakdown.
 */
export function Spend() {
  // Selectors build fresh arrays, so they are read off a snapshot here rather
  // than passed to useRoster, which would loop on the new reference.
  const state = useRoster()

  const totals = useMemo(() => selectRosterTotals(state), [state])
  const byProvider = useMemo(() => selectSpendByProvider(state), [state])
  const byAgent = useMemo(() => selectSpendByAgent(state), [state])
  const byProject = useMemo(() => selectSpendByProject(state), [state])

  const nothingRun = byProvider.length === 0 && byAgent.length === 0 && byProject.length === 0

  return (
    <div className="flex h-screen flex-col">
      <ScreenHeader title="Spend">
        <span className="text-md text-dim">{formatCost(totals.costUsd)} across all agents</span>
      </ScreenHeader>

      {nothingRun ? (
        <div className="flex flex-1 items-center justify-center text-md text-dim">
          Nothing spent yet.
        </div>
      ) : (
        <div className="flex min-h-0 max-w-[640px] flex-1 flex-col gap-[28px] overflow-y-auto px-[18px] py-[20px]">
          <section className="flex flex-col gap-[16px]">
            <SectionLabel>By provider</SectionLabel>
            {byProvider.map((provider) => (
              <div key={provider.key} className="flex flex-col gap-[8px]">
                <Row bar={provider} emphasis />
                {provider.models?.map((model) => (
                  <Row key={model.key} bar={model} nested />
                ))}
              </div>
            ))}
          </section>

          <section className="flex flex-col gap-[12px]">
            <SectionLabel>By agent</SectionLabel>
            {byAgent.map((agent) => (
              <Row key={agent.key} bar={agent} />
            ))}
          </section>

          <section className="flex flex-col gap-[12px]">
            <SectionLabel>By project</SectionLabel>
            {byProject.map((project) => (
              <Row key={project.key} bar={project} />
            ))}
          </section>
        </div>
      )}
    </div>
  )
}

interface RowProps {
  bar: SpendBar
  /** Provider rows carry their group's name, so they read heavier. */
  emphasis?: boolean
  /** Model sub-rows: indented, smaller, and dimmer than their provider. */
  nested?: boolean
}

/**
 * Label, track, figure. The track is decorative — the label and the dollar
 * figure beside it already say everything the bar does.
 */
function Row({ bar, emphasis = false, nested = false }: RowProps) {
  return (
    <div className={`flex items-center gap-[12px] ${nested ? 'pl-[20px]' : ''}`}>
      <span
        className={
          nested
            ? 'w-[150px] flex-none truncate font-mono text-sm text-muted-2'
            : `w-[110px] flex-none truncate text-lg text-ink-3 ${emphasis ? 'font-semibold' : ''}`
        }
      >
        {bar.label}
      </span>

      <div
        aria-hidden
        className={`flex-1 overflow-hidden bg-card ${
          nested ? 'h-[6px] rounded-[3px]' : 'h-[8px] rounded-[4px]'
        }`}
      >
        <div
          className={`h-full ${nested ? 'rounded-[3px] opacity-75' : 'rounded-[4px]'}`}
          style={{ width: `${bar.pct}%`, background: bar.color }}
        />
      </div>

      <span
        className={`w-[64px] flex-none text-right font-mono ${
          nested ? 'text-sm text-amber-dim' : 'text-md text-amber'
        }`}
      >
        {bar.formatted}
      </span>
    </div>
  )
}
