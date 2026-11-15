import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import {
  agentStatus,
  useRoster,
  matchedBySession,
  selectSidebarAgents,
  selectSidebarSessions,
  selectVisibleAgents,
  sessionsInProject,
  type Screen,
} from '@/state/store'
import { flowEdges, sessionsByTask } from '@/state/workflow'
import type { Agent, Session, Task } from '@shared/types'
import { sessionLabel } from '@shared/sessions'
import { formatUsageCost } from '@/state/format'
import { selectRosterTotals } from '@/state/spend'
import { ProjectFilter } from './ProjectFilter'
import { UpdateRow } from './UpdateRow'
import { ChevronIcon } from './icons'
import { StatusDot } from './primitives'

interface NavItem {
  key: Screen
  label: string
  /** Overrides the default dot colour, per the handoff's Spend row. */
  dot?: string
  disabled?: boolean
}

/** The disclosure column, which every roster row reserves so names line up. */
const DISCLOSURE_PX = 13
/** How far a session sits inside the agent it belongs to. */
const SESSION_INDENT_PX = 10

/** What the rail's box searches, said in the box and to a screen reader. */
const SEARCH_LABEL = 'Search agents and sessions'

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
  // The roster you can actually see. Counting hidden agents here would put a
  // number on the badge that no list below it accounts for.
  const rosterSize = useRoster((s) => selectVisibleAgents(s).length)
  const skills = useRoster((s) => s.skills)
  const mcpServers = useRoster((s) => s.mcpServers)
  const tasks = useRoster((s) => s.tasks)
  const agents = useRoster(useShallow(selectSidebarAgents))
  const totals = useRoster(useShallow(selectRosterTotals))
  const appVersion = useRoster((s) => s.appVersion)
  const taskRows = useLinkedTasks()

  const counts: Record<string, string> = {
    grid: String(rosterSize),
    skills: String(skills.length),
    mcp: String(mcpServers.length),
    tasks: String(tasks.length),
    spend: formatUsageCost(totals.costUsd, totals.hasEstimatedCost, totals.hasUnavailableCost),
  }

  return (
    <nav className="flex w-sidebar min-h-0 flex-none flex-col border-r border-line bg-rail">
      {/* The one project filter for the whole app. It sits first, above the
          navigation, so it is in view on every screen and every screen reads
          the same value — see ProjectFilter. */}
      <div className="flex flex-col px-[8px] pt-[12px] pb-[4px]">
        <ProjectFilter compact />
      </div>

      <div className="flex flex-col gap-[1px] px-[8px] py-[8px]">
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
          {agents.length}/{rosterSize}
        </span>
      </div>

      <div className="flex flex-col gap-[6px] px-[8px] pb-[8px]">
        <input
          type="text"
          value={query}
          aria-label={SEARCH_LABEL}
          placeholder={SEARCH_LABEL}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-chip border border-line bg-card px-[9px] py-[6px] font-ui text-md text-ink outline-none placeholder:text-faint focus:border-accent-line focus:bg-accent-surface-2"
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[1px] overflow-y-auto px-[8px] pb-[8px]">
        {agents.map((agent) => (
          <SidebarAgentRow key={agent.id} agent={agent} />
        ))}

        {taskRows.length > 0 ? <LinkedTasksSection rows={taskRows} /> : null}
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

/** A task with the sessions working on it, as the rail lists them. */
interface LinkedTaskRow {
  task: Task
  /** The sessions to list: the project filter and the search have had their say. */
  sessions: Session[]
  /** Whether the session open on screen is one of them. */
  holdsOpenSession: boolean
  /** In the rail only because one of its sessions matched a search: it unfolds itself, as an agent does. */
  revealed: boolean
}

/**
 * The tasks that have a session working on them, for the rail.
 *
 * Built from the sessions the rail already holds: a session that a mention
 * opened carries its task, and the handed-off sessions it started are joined
 * to that task through the same walk the Workflow canvas uses — so the rail
 * and the canvas agree on who is on a task.
 *
 * The project filter narrows the sessions, and a task with none left is
 * dropped, as an agent is not — the same rule the agent rows follow. A search
 * keeps a task whose title or key it matches with all its sessions, and
 * otherwise keeps only the sessions that match.
 */
function useLinkedTasks(): LinkedTaskRow[] {
  const tasks = useRoster((s) => s.tasks)
  const projects = useRoster((s) => s.projects)
  const projectFilter = useRoster((s) => s.projectFilter)
  const query = useRoster((s) => s.query)
  const sessions = useRoster(useShallow((s) => Object.values(s.sessions).flat()))
  const openSessionId = useRoster((s) =>
    s.screen === 'agent' && s.agentId ? s.sess[s.agentId] : undefined,
  )

  return useMemo(() => {
    const archived = new Set(projects.filter((p) => p.archivedAt !== null).map((p) => p.id))
    const byId = new Map(sessions.map((session) => [session.id, session]))
    const byTask = sessionsByTask(sessions, flowEdges(sessions))
    const q = query.trim().toLowerCase()

    return tasks.flatMap((task): LinkedTaskRow[] => {
      const members = byTask.get(task.id)
      if (members === undefined) return []

      const linked = [...members]
        .map((id) => byId.get(id))
        .filter((session): session is Session => session !== undefined)
      const visible = [...sessionsInProject(linked, projectFilter, archived)]
      if (visible.length === 0) return []

      const taskMatched =
        q === '' ||
        task.id.toLowerCase().includes(q) ||
        task.title.toLowerCase().includes(q)
      const shown = taskMatched
        ? visible
        : visible.filter((session) => sessionLabel(session).toLowerCase().includes(q))
      if (shown.length === 0) return []

      return [
        {
          task,
          sessions: shown,
          holdsOpenSession: visible.some((session) => session.id === openSessionId),
          revealed: !taskMatched,
        },
      ]
    })
  }, [tasks, projects, projectFilter, query, sessions, openSessionId])
}

interface LinkedTasksSectionProps {
  rows: LinkedTaskRow[]
}

/**
 * The tasks being worked on, under the agents: the other half of the rail.
 *
 * Agents answer "who is here"; this answers "what is being done", so that from
 * a session you can see the task it is part of and from a task you can see
 * every session on it.
 */
function LinkedTasksSection({ rows }: LinkedTasksSectionProps) {
  return (
    <section aria-label="Linked tasks" className="mt-[10px] flex flex-col gap-[1px]">
      <div className="flex items-center px-[8px] pt-[4px] pb-[6px]">
        <span className="text-xs font-semibold uppercase tracking-[0.07em] text-label">
          Linked tasks
        </span>
        <span className="ml-auto font-mono text-xs text-faint-2">{rows.length}</span>
      </div>
      {rows.map((row) => (
        <SidebarTaskRow key={row.task.id} row={row} />
      ))}
    </section>
  )
}

function SidebarTaskRow({ row }: { row: LinkedTaskRow }) {
  const { task, sessions, holdsOpenSession, revealed } = row
  const [expanded, setExpanded] = useState(false)
  const openSessionId = useRoster((s) =>
    s.screen === 'agent' && s.agentId ? s.sess[s.agentId] : undefined,
  )
  const agentNames = useRoster(
    useShallow((s) => Object.fromEntries(s.agents.map((agent) => [agent.id, agent.name]))),
  )
  const openAgent = useRoster((s) => s.openAgent)
  const openTask = useRoster((s) => s.openTask)
  const go = useRoster((s) => s.go)

  // Unfolded when you are in one of its sessions, as a search reveals an agent:
  // the task you are working on should be the first thing you see.
  const isExpanded = expanded || holdsOpenSession || revealed

  return (
    <div className="flex flex-col gap-[1px]">
      <div className="flex items-center rounded-chip text-muted hover:bg-[#1a1c23] hover:text-ink">
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${task.title}`}
          title={`${isExpanded ? 'Collapse' : 'Expand'} ${task.title}`}
          onClick={() => setExpanded((value) => !value)}
          style={{ width: DISCLOSURE_PX }}
          className="flex h-[16px] flex-none cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-dim-2 hover:text-ink"
        >
          <ChevronIcon expanded={isExpanded} />
        </button>

        <button
          type="button"
          onClick={() => {
            // The task first, so the board is showing it when the screen changes
            // rather than for one frame with no modal at all — as AgentDetail does.
            openTask(task.id)
            go('tasks')
          }}
          title={`${task.id} ${task.title}`}
          className={`flex min-w-0 flex-1 cursor-pointer items-center gap-[7px] border-0 bg-transparent py-[6px] pr-[8px] pl-[5px] text-left font-ui text-lg text-inherit ${
            holdsOpenSession ? 'text-ink' : ''
          }`}
        >
          <span className="flex-none font-mono text-xs text-faint-2">{task.id}</span>
          <span className="truncate">{task.title}</span>
          <span className="ml-auto flex-none font-mono text-xs text-faint-2">{sessions.length}</span>
        </button>
      </div>

      {isExpanded
        ? sessions.map((session) => (
            <SidebarSessionRow
              key={session.id}
              session={session}
              active={session.id === openSessionId}
              agentName={agentNames[session.agentId]}
              onOpen={() => openAgent(session.agentId, session.id)}
            />
          ))
        : null}
    </div>
  )
}

interface SidebarAgentRowProps {
  agent: Agent
}

/**
 * An agent, and — once its row is unfolded — the sessions underneath it.
 *
 * The disclosure is a control of its own beside the name, as the Skills tree
 * draws it, so opening a row and opening the agent stay separate acts.
 */
function SidebarAgentRow({ agent }: SidebarAgentRowProps) {
  const status = useRoster((s) => agentStatus(s, agent))
  const sessions = useRoster(useShallow((s) => selectSidebarSessions(s, agent)))
  const expanded = useRoster((s) => s.expandedAgents[agent.id] === true)
  const revealed = useRoster((s) => matchedBySession(s, agent))
  const openAgent = useRoster((s) => s.openAgent)
  const toggleAgentExpanded = useRoster((s) => s.toggleAgentExpanded)
  // Which session this agent is showing, so the rail marks where you are.
  const openSessionId = useRoster((s) =>
    s.screen === 'agent' && s.agentId === agent.id ? s.sess[agent.id] : undefined,
  )

  // A search that reached this row through a session opens it whatever state
  // it was left in: a match you cannot see is not an answer.
  const isExpanded = expanded || revealed

  return (
    <div className="flex flex-col gap-[1px]">
      <div className="flex items-center rounded-chip text-muted hover:bg-[#1a1c23] hover:text-ink">
        {sessions.length === 0 ? (
          // A row with nothing under it keeps the column so the names still
          // line up, but gets no control: one that does nothing is worse.
          <span aria-hidden className="flex-none" style={{ width: DISCLOSURE_PX }} />
        ) : (
          <button
            type="button"
            // Announced, not merely drawn: a caret alone says nothing aloud.
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${agent.name}`}
            title={`${isExpanded ? 'Collapse' : 'Expand'} ${agent.name}`}
            onClick={() => toggleAgentExpanded(agent.id)}
            style={{ width: DISCLOSURE_PX }}
            className="flex h-[16px] flex-none cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-dim-2 hover:text-ink"
          >
            <ChevronIcon expanded={isExpanded} />
          </button>
        )}

        <button
          type="button"
          onClick={() => openAgent(agent.id)}
          title={agent.statusDetail ?? agent.name}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-[9px] border-0 bg-transparent py-[6px] pr-[8px] pl-[5px] text-left font-ui text-xl text-inherit"
        >
          <StatusDot status={status} />
          <span className="truncate">{agent.name}</span>
          {/* What the row will list, not what the agent owns: under a search
              the two differ, and the badge belongs to the list below it. */}
          <span className="ml-auto font-mono text-xs text-faint-2">{sessions.length}</span>
        </button>
      </div>

      {isExpanded
        ? sessions.map((session) => (
            <SidebarSessionRow
              key={session.id}
              session={session}
              active={session.id === openSessionId}
              onOpen={() => openAgent(agent.id, session.id)}
            />
          ))
        : null}
    </div>
  )
}

interface SidebarSessionRowProps {
  session: Session
  active: boolean
  onOpen: () => void
  /** Shown beside the label when the row sits under a task, where the agent is not already its parent. */
  agentName?: string
}

function SidebarSessionRow({ session, active, onOpen, agentName }: SidebarSessionRowProps) {
  const label = sessionLabel(session)

  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={onOpen}
      // The rail is 216px wide, so most names are cut short. The whole one is
      // a hover away rather than lost.
      title={label}
      style={{ paddingLeft: DISCLOSURE_PX + SESSION_INDENT_PX }}
      className={`flex cursor-pointer items-center gap-[8px] rounded-chip border-0 py-[4px] pr-[8px] text-left font-ui text-lg hover:bg-[#1a1c23] hover:text-ink ${
        active ? 'bg-[#1c1e26] text-ink' : 'bg-transparent text-muted-2'
      }`}
    >
      <StatusDot status={session.status} size={5} />
      <span className="truncate">{label}</span>
      {agentName ? (
        <span className="ml-auto flex-none truncate pl-[4px] text-xs text-faint-2">{agentName}</span>
      ) : null}
    </button>
  )
}

