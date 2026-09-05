import { useState } from 'react'
import type { Agent, Session, TranscriptLine } from '@shared/types'
import { sessionLabel } from '@shared/sessions'
import { statusColor, statusLabel, transcriptOpacity } from '@shared/status'
import { useShallow } from 'zustand/shallow'
import {
  ALL_PROJECTS,
  agentStatus,
  useRoster,
  selectGridAgents,
  selectVisibleAgents,
  sessionsInProject,
  archivedProjectIds,
  NO_LINES,
  NO_SESSIONS,
} from '@/state/store'
import {
  GhostButton,
  PrimaryButton,
  ScreenHeader,
  StatusDot,
  TextInput,
} from '@/components/primitives'
import { FirstRunCard } from '@/components/FirstRunCard'
import { ProjectFilter } from '@/components/ProjectFilter'
import { formatCost, formatTokens } from '@/state/format'
import { selectRosterTotals } from '@/state/spend'
import { ManageAgentsModal } from './ManageAgentsModal'

export function AgentsGrid() {
  const agents = useRoster(useShallow(selectGridAgents))
  // Counts are measured against the visible roster, never the whole one: a
  // number the user cannot reconcile with the cards in front of them is worse
  // than no number.
  const visible = useRoster((s) => selectVisibleAgents(s).length)
  const hidden = useRoster((s) => s.agents.length - selectVisibleAgents(s).length)
  const gridQuery = useRoster((s) => s.gridQuery)
  const setGridQuery = useRoster((s) => s.setGridQuery)
  const projectFilter = useRoster((s) => s.projectFilter)
  const go = useRoster((s) => s.go)
  const [managing, setManaging] = useState(false)

  // A count, not an array: a fresh array here re-renders forever.
  const running = useRoster(
    (s) => agents.filter((agent) => agentStatus(s, agent) === 'running').length,
  )
  // An agent whose every session sits under an archived project leaves the
  // grid too, so a shorter list than `visible` is itself a kind of filtering —
  // without this the header would claim more agents than it is showing.
  const filtering =
    gridQuery.trim() !== '' || projectFilter !== ALL_PROJECTS || agents.length !== visible

  const summary = filtering
    ? `${agents.length} of ${visible} match`
    : hidden > 0
      ? `${visible} shown · ${hidden} hidden · ${running} running`
      : `${visible} configured · ${running} running`

  return (
    <div className="flex h-screen flex-col">
      <ScreenHeader title="Agents">
        <span className="text-md text-dim">{summary}</span>
        <div className="ml-auto flex items-center gap-[8px]">
          <ProjectFilter />
          <TextInput
            ariaLabel="Filter agents"
            placeholder="Filter agents"
            value={gridQuery}
            onChange={setGridQuery}
            className="w-[200px]"
          />
          <GhostButton onClick={() => setManaging(true)}>Manage</GhostButton>
          <PrimaryButton onClick={() => go('new')}>New agent</PrimaryButton>
        </div>
      </ScreenHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-[18px]">
        <FirstRunCard />
        {agents.length === 0 ? (
          <EmptyState
            filtered={filtering}
            allHidden={hidden > 0 && visible === 0}
            onManage={() => setManaging(true)}
          />
        ) : (
          <div className="grid min-h-full grid-cols-2 gap-[24px] [grid-auto-rows:minmax(268px,1fr)]">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>

      <StatusBar />

      {managing ? <ManageAgentsModal onClose={() => setManaging(false)} /> : null}
    </div>
  )
}

interface AgentCardProps {
  agent: Agent
}

function AgentCard({ agent }: AgentCardProps) {
  const openAgent = useRoster((s) => s.openAgent)
  const projectFilter = useRoster((s) => s.projectFilter)
  // The same predicate the card list used. If these two ever disagreed, a
  // card would render with no chips in it.
  const sessions = useRoster(
    useShallow((s) =>
      sessionsInProject(s.sessions[agent.id] ?? NO_SESSIONS, projectFilter, archivedProjectIds(s)),
    ),
  )
  const selected = useRoster((s) => s.sess[agent.id])
  const status = useRoster((s) => agentStatus(s, agent))
  const needsApproval = status === 'approval'

  return (
    <button
      type="button"
      onClick={() => openAgent(agent.id)}
      className="flex min-h-0 cursor-pointer flex-col overflow-hidden rounded-card border bg-card p-0 text-left hover:border-[#34374a]"
      style={{
        borderColor: needsApproval ? 'var(--color-amber-line-card)' : 'var(--color-line)',
        animation: needsApproval ? 'var(--animate-pulse-approval)' : undefined,
      }}
    >
      <div className="flex flex-none items-center gap-[8px] border-b border-line bg-header px-[12px] py-[9px]">
        <StatusDot status={status} size={7} />
        <span className="text-lg font-semibold">{agent.name}</span>
        <span className="text-sm font-medium" style={{ color: statusColor(status) }}>
          {statusLabel(status)}
        </span>
        <span className="ml-auto truncate font-mono text-xs text-dim-2">{agent.model}</span>
      </div>

      <div className="flex flex-none gap-[4px] overflow-hidden border-b border-line bg-well px-[10px] py-[6px]">
        {sessions.length === 0 ? (
          <span className="text-sm text-faint-2">no sessions yet</span>
        ) : (
          sessions.map((session) => (
            <SessionChip
              key={session.id}
              session={session}
              agentId={agent.id}
              active={session.id === selected}
            />
          ))
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-end gap-[7px] overflow-hidden px-[12px] py-[10px]">
        {status === 'error' && agent.statusDetail ? (
          <p className="m-0 text-md leading-[1.45] text-error">{agent.statusDetail}</p>
        ) : (
          <Transcript agentId={agent.id} />
        )}
      </div>

      <div className="flex flex-none items-center gap-[10px] border-t border-line bg-header px-[12px] py-[7px] font-mono text-xs text-dim-2">
        <span className="truncate">{agent.cwdLabel}</span>
        <Spend agentId={agent.id} />
      </div>
    </button>
  )
}

/**
 * What this agent has cost, summed over every session it owns.
 *
 * Selecting the two numbers rather than the object keeps this from
 * re-rendering every card whenever any agent's totals change.
 */
function Spend({ agentId }: { agentId: string }) {
  const tokens = useRoster((s) => s.agentUsage[agentId]?.tokens ?? 0)
  const costUsd = useRoster((s) => s.agentUsage[agentId]?.costUsd ?? 0)

  return (
    <>
      <span className="ml-auto flex-none">{formatTokens(tokens)}</span>
      <span className="flex-none">{formatCost(costUsd)}</span>
    </>
  )
}

/**
 * The last few lines of this agent's most recent session, oldest at the top.
 * Older lines fade, so the newest reads first at a glance.
 */
function Transcript({ agentId }: { agentId: string }) {
  const lines = useRoster(useShallow((s) => s.transcripts[agentId] ?? NO_LINES))

  if (lines.length === 0) {
    return <p className="m-0 text-md leading-[1.45] text-faint-2">No messages yet.</p>
  }

  return (
    <>
      {lines.map((line, index) => (
        <TranscriptRow
          key={`${line.who}:${index}`}
          line={line}
          opacity={transcriptOpacity(index, lines.length)}
        />
      ))}
    </>
  )
}

/** Roles are coloured per the handoff: you grey, agent purple, tool light purple. */
const ROLE_COLOUR: Record<TranscriptLine['role'], string> = {
  user: 'var(--color-muted-2)',
  agent: 'var(--color-accent)',
  tool: 'var(--color-accent-light)',
}

interface TranscriptRowProps {
  line: TranscriptLine
  opacity: number
}

function TranscriptRow({ line, opacity }: TranscriptRowProps) {
  return (
    <div className="flex items-baseline gap-[8px]" style={{ opacity }}>
      <span
        className="w-[52px] flex-none truncate font-mono text-2xs uppercase tracking-[0.04em]"
        style={{ color: ROLE_COLOUR[line.role] }}
      >
        {line.who}
      </span>
      <span className="line-clamp-2 text-md leading-[1.45] text-ink-4">{line.text}</span>
    </div>
  )
}

interface SessionChipProps {
  session: Session
  agentId: string
  active: boolean
}

function SessionChip({ session, agentId, active }: SessionChipProps) {
  const openAgent = useRoster((s) => s.openAgent)

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation()
        openAgent(agentId, session.id)
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.stopPropagation()
        openAgent(agentId, session.id)
      }}
      className={`flex max-w-[150px] cursor-pointer items-center gap-[6px] overflow-hidden rounded-sm px-[8px] py-[3px] text-sm whitespace-nowrap hover:bg-[#1c1e26] ${
        active ? 'bg-[#1c1e26] text-ink-2' : 'bg-transparent text-dim'
      }`}
    >
      <span aria-hidden className="text-dim-2">
        {session.origin === 'agent' ? '↳' : '•'}
      </span>
      <span className="truncate">{sessionLabel(session)}</span>
      <StatusDot status={session.status} size={5} />
    </span>
  )
}

interface EmptyStateProps {
  filtered: boolean
  /** Every agent exists but each is hidden — a different problem entirely. */
  allHidden: boolean
  onManage: () => void
}

function EmptyState({ filtered, allHidden, onManage }: EmptyStateProps) {
  const go = useRoster((s) => s.go)

  // Order matters: an all-hidden roster is not empty, and offering "New agent"
  // there would answer a question nobody asked.
  if (filtered) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-[10px]">
        <p className="m-0 text-md text-dim">No agents match that filter.</p>
      </div>
    )
  }

  if (allHidden) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-[10px]">
        <p className="m-0 text-md text-dim">Every agent is hidden.</p>
        <PrimaryButton onClick={onManage}>Manage agents</PrimaryButton>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-[10px]">
      <p className="m-0 text-md text-dim">No agents configured yet.</p>
      <PrimaryButton onClick={() => go('new')}>New agent</PrimaryButton>
    </div>
  )
}

function StatusBar() {
  // The handoff puts a tokens/cost readout at the right of this bar. It
  // labels it "session", but no session is current on the grid — the honest
  // figure at this altitude is what the whole roster has spent.
  const totals = useRoster(useShallow(selectRosterTotals))

  return (
    <footer className="flex h-statusbar flex-none items-center gap-[12px] border-t border-line bg-rail px-[18px]">
      <span className="flex items-center gap-[6px] text-base text-[#5a5d69]">
        <span aria-hidden className="text-accent-light">
          ↳
        </span>
        session opened by another agent
      </span>

      <span className="ml-auto font-mono text-xs text-dim-2">
        roster {formatTokens(totals.tokens)} · {formatCost(totals.costUsd)}
      </span>
    </footer>
  )
}
