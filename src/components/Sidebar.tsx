import { useShallow } from 'zustand/shallow'
import { agentStatus, useRoster, selectSidebarAgents, NO_SESSIONS, type Screen } from '@/state/store'
import type { Agent } from '@shared/types'
import { formatCost } from '@/state/format'
import { selectRosterTotals } from '@/state/spend'
import { Logo } from './Logo'
import { UpdateRow } from './UpdateRow'
import { StatusDot } from './primitives'

interface NavItem {
  key: Screen
  label: string
  /** Overrides the default dot colour, per the handoff's Spend row. */
  dot?: string
  disabled?: boolean
}

const NAV: NavItem[] = [
  { key: 'grid', label: 'Agents' },
  { key: 'skills', label: 'Skills' },
  { key: 'mcp', label: 'MCP servers' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'spend', label: 'Spend', dot: 'var(--color-amber)' },
]

export function Sidebar() {
  const screen = useRoster((s) => s.screen)
  const go = useRoster((s) => s.go)
  const query = useRoster((s) => s.query)
  const setQuery = useRoster((s) => s.setQuery)
  const openAgent = useRoster((s) => s.openAgent)
  const allAgents = useRoster((s) => s.agents)
  const skills = useRoster((s) => s.skills)
  const mcpServers = useRoster((s) => s.mcpServers)
  const tasks = useRoster((s) => s.tasks)
  const agents = useRoster(useShallow(selectSidebarAgents))
  const totals = useRoster(useShallow(selectRosterTotals))
  const appVersion = useRoster((s) => s.appVersion)

  const counts: Record<string, string> = {
    grid: String(allAgents.length),
    skills: String(skills.length),
    mcp: String(mcpServers.length),
    tasks: String(tasks.length),
    spend: formatCost(totals.costUsd),
  }

  return (
    <nav className="flex w-sidebar flex-none flex-col border-r border-line bg-rail">
      <WindowChrome />

      <div className="flex flex-col gap-[1px] px-[8px] py-[12px]">
        {NAV.map((item) => {
          const active = screen === item.key
          return (
            <button
              key={item.key}
              type="button"
              disabled={item.disabled}
              aria-current={active ? 'page' : undefined}
              onClick={() => !item.disabled && go(item.key)}
              className={`flex items-center gap-[9px] rounded-chip border-0 px-[8px] py-[6px] text-left font-ui text-xl ${
                item.disabled ? 'cursor-default' : 'cursor-pointer hover:bg-[#1a1c23]'
              } ${active ? 'bg-[#1c1e26] text-ink' : 'bg-transparent text-muted'}`}
            >
              <span
                aria-hidden
                className="rounded-[1.5px]"
                style={{
                  width: 5,
                  height: 5,
                  background: item.disabled
                    ? 'var(--color-off)'
                    : (item.dot ?? 'var(--color-muted-2)'),
                }}
              />
              <span className="font-medium">{item.label}</span>
              <span className="ml-auto text-sm text-[#5a5d69]">{counts[item.key]}</span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center px-[16px] pt-[10px] pb-[6px]">
        <span className="text-xs font-semibold uppercase tracking-[0.07em] text-label">Roster</span>
        <span className="ml-auto font-mono text-xs text-faint-2">
          {agents.length}/{allAgents.length}
        </span>
      </div>

      <div className="px-[8px] pb-[8px]">
        <input
          type="text"
          value={query}
          aria-label="Search agents"
          placeholder="Search agents"
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-chip border border-line bg-card px-[9px] py-[6px] font-ui text-md text-ink outline-none placeholder:text-faint focus:border-accent-line focus:bg-accent-surface-2"
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[1px] overflow-y-auto px-[8px] pb-[8px]">
        {agents.map((agent) => (
          <SidebarAgentRow key={agent.id} agent={agent} onOpen={() => openAgent(agent.id)} />
        ))}
      </div>

      <UpdateRow />

      <div className="flex flex-none items-center gap-[8px] border-t border-line p-[10px]">
        <span
          aria-hidden
          className="flex h-[22px] w-[22px] items-center justify-center rounded-chip bg-[#20222b] text-2xs font-semibold text-muted"
        >
          JD
        </span>
        <span className="text-md text-muted">Local workspace</span>
        {/* Which build this is. Without it there is no reading an update
            prompt — "0.1.2 available" says nothing on its own. */}
        {appVersion ? (
          <span className="ml-auto font-mono text-xs text-faint-2">v{appVersion}</span>
        ) : null}
      </div>
    </nav>
  )
}

interface SidebarAgentRowProps {
  agent: Agent
  onOpen: () => void
}

function SidebarAgentRow({ agent, onOpen }: SidebarAgentRowProps) {
  const status = useRoster((s) => agentStatus(s, agent))
  const sessionCount = useRoster((s) => (s.sessions[agent.id] ?? NO_SESSIONS).length)

  return (
          <button
            type="button"
            onClick={onOpen}
            title={agent.statusDetail ?? agent.name}
            className="flex cursor-pointer items-center gap-[9px] rounded-chip border-0 bg-transparent px-[8px] py-[6px] text-left font-ui text-xl text-muted hover:bg-[#1a1c23] hover:text-ink"
          >
            <StatusDot status={status} />
            <span className="truncate">{agent.name}</span>
            <span className="ml-auto font-mono text-xs text-faint-2">{sessionCount}</span>
          </button>
  )
}

/**
 * The design draws its own window controls in the sidebar header, so the
 * native frame is disabled and these three dots are the real controls.
 */
function WindowChrome() {
  // The traffic-light convention, in the app's own palette rather than
  // macOS's saturated one, which would shout next to everything else here.
  // Colour alone does not identify a button, so each keeps its label and
  // gains a tooltip.
  const controls = [
    {
      label: 'Minimize window',
      color: 'var(--color-amber)',
      action: () => window.roster.window.minimize(),
    },
    {
      label: 'Maximize window',
      color: 'var(--color-done)',
      action: () => window.roster.window.maximize(),
    },
    {
      label: 'Close window',
      color: 'var(--color-error)',
      action: () => window.roster.window.close(),
    },
  ]

  return (
    <header
      className="flex h-header flex-none items-center gap-[8px] border-b border-line px-[14px]"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <Logo />
      <span className="font-semibold tracking-[-0.01em]">Roster</span>
      <div
        className="ml-auto flex gap-[5px]"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {controls.map((control) => (
          <button
            key={control.label}
            type="button"
            aria-label={control.label}
            title={control.label}
            onClick={control.action}
            style={{ background: control.color }}
            className="h-[9px] w-[9px] cursor-pointer rounded-full border-0 p-0 opacity-85 hover:opacity-100"
          />
        ))}
      </div>
    </header>
  )
}
