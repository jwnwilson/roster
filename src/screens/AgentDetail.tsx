import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import type { Agent, Approval, Session } from '@shared/types'
import { EXIT_PLAN_MODE } from '@shared/plans'
import { sessionLabel } from '@shared/sessions'
import { statusColor } from '@shared/status'
import { taskStatusColor } from '@shared/tasks'
import { contextFraction, contextLabel } from '@shared/models'
import { AssistantChatPane } from '@/chat/AssistantChatPane'
import { EditAgentModal } from './EditAgentModal'
import { SessionName } from './SessionName'
import { PlanModal } from './PlanModal'
import { messageFor } from '@/lib/errors'
import { SectionLabel, Segmented, Select, StatusDot } from '@/components/primitives'
import { TerminalPane } from '@/terminal/TerminalPane'
import {
  agentStatus,
  NO_SESSIONS,
  reduceSessionEvent,
  projectOptionLabel,
  projectPickerProjects,
  selectCurrentAgent,
  useRoster,
  type PaneMode,
} from '@/state/store'

/** The "no project" option value, distinct from a real project id. */
const NO_PROJECT = 'none'

const MODES = [
  { value: 'chat' as const, label: 'Chat' },
  { value: 'terminal' as const, label: 'Terminal' },
]

export function AgentDetail() {
  const agent = useRoster(selectCurrentAgent)
  const go = useRoster((s) => s.go)

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center text-md text-dim">
        That agent is no longer on disk.{' '}
        <button
          type="button"
          onClick={() => go('grid')}
          className="ml-[6px] cursor-pointer border-0 bg-transparent p-0 font-ui text-md text-accent-light underline"
        >
          Back to agents
        </button>
      </div>
    )
  }

  return <AgentDetailBody agent={agent} />
}

function AgentDetailBody({ agent }: { agent: Agent }) {
  const go = useRoster((s) => s.go)
  const mode = useRoster((s) => s.mode)
  const planMode = useRoster((s) => s.planMode)
  const togglePlanMode = useRoster((s) => s.togglePlanMode)
  const setMode = useRoster((s) => s.setMode)
  const sessions = useRoster(useShallow((s) => s.sessions[agent.id] ?? NO_SESSIONS))
  const activeId = useRoster((s) => s.sess[agent.id])
  const messages = useRoster(useShallow((s) => (activeId ? (s.messages[activeId] ?? []) : [])))
  const streaming = useRoster((s) => (activeId ? (s.streaming[activeId] ?? false) : false))
  const activity = useRoster((s) => (activeId ? s.activity[activeId] : undefined))
  const approvals = useRoster(
    useShallow((s) => (activeId ? (s.approvals[activeId] ?? []) : [])),
  )
  const setSessions = useRoster((s) => s.setSessions)
  const setMessages = useRoster((s) => s.setMessages)
  const setUsage = useRoster((s) => s.setUsage)
  const setApprovals = useRoster((s) => s.setApprovals)
  const selectSession = useRoster((s) => s.selectSession)
  const setNamingSession = useRoster((s) => s.setNamingSession)
  const editOpen = useRoster((s) => s.editOpen)
  const openPlanId = useRoster((s) => s.openPlanId)
  const status = useRoster((s) => agentStatus(s, agent))
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Sessions come from SQLite, not from the agent config, so they load per
  // agent rather than at startup.
  useEffect(() => {
    let cancelled = false
    void window.roster.sessions.listByAgent(agent.id).then((loaded) => {
      if (!cancelled) setSessions(agent.id, loaded)
    })
    return () => {
      cancelled = true
    }
  }, [agent.id, setSessions])

  useEffect(() => {
    if (!activeId) return
    let cancelled = false

    void window.roster.sessions.messages(activeId).then((loaded) => {
      if (!cancelled) setMessages(activeId, loaded)
    })
    // Usage is persisted, so a reopened session shows its real totals.
    void window.roster.sessions.usage(activeId).then((loaded) => {
      if (!cancelled && loaded) setUsage(activeId, loaded)
    })
    // An approval lives in the main process for as long as the agent is
    // blocked on it. Without this, reloading the window loses the question
    // while the agent is still waiting for its answer.
    void window.roster.sessions.pendingApprovals(activeId).then((loaded) => {
      if (cancelled || loaded.length === 0) return
      // Only when this window knows of none. While it is open the live events
      // are the truth, and a reply that arrived during this round trip would
      // otherwise be replaced by the answer to a question already gone.
      if ((useRoster.getState().approvals[activeId] ?? []).length > 0) return
      setApprovals(activeId, loaded)
    })

    return () => {
      cancelled = true
    }
  }, [activeId, setMessages, setUsage, setApprovals])

  // Opening an agent from the sidebar or a card body names no session, which
  // used to leave the tab strip full and the pane empty. The newest is the
  // one the grid previews, so it is the one to land on.
  useEffect(() => {
    if (activeId !== undefined || sessions.length === 0) return

    const newest = sessions[sessions.length - 1]
    if (newest) selectSession(agent.id, newest.id)
  }, [activeId, sessions, agent.id, selectSession])

  const active = sessions.find((s) => s.id === activeId) ?? null
  // Split rather than "whichever came first": a question is answered in the
  // transcript and a command in the banner, so an agent blocked on both needs
  // both, and a question queued behind a command must not go unasked.
  const questioning = approvals.find((approval) => approval.questions !== undefined) ?? null
  const pending = approvals.find((approval) => approval.questions === undefined) ?? null
  const asking = questioning?.questions ?? null

  function respondToQuestion(answers: Record<string, string>): void {
    if (!questioning || !activeId) return
    void window.roster.sessions.respondToApproval(activeId, questioning.id, true, answers)
  }

  async function newSession(): Promise<void> {
    const created = await window.roster.sessions.create(agent.id)
    setSessions(agent.id, [...sessions, created])
    selectSession(agent.id, created.id)
    // The nudge. The session already exists and the composer already works;
    // this only puts the cursor where a name would go.
    setNamingSession(created.id)
  }

  /**
   * Deletes a session, transcript and all.
   *
   * The confirmation lives in the main process, as it does for a task or a
   * skill, so a dismissal comes back as false rather than as a rejection and
   * nothing here should move. Spend and the grid's preview lines both counted
   * this session, so both are re-read once it has gone.
   */
  async function deleteSession(sessionId: string): Promise<void> {
    setDeleteError(null)

    try {
      const deleted = await window.roster.sessions.remove(sessionId)
      if (!deleted) return

      // The same event the broadcast will carry, applied now so the tab strip
      // stops showing a session that is gone. Applying it twice is safe.
      useRoster.setState((state) =>
        reduceSessionEvent(state, { type: 'session-deleted', sessionId, agentId: agent.id }),
      )

      const [spend, transcripts] = await Promise.all([
        window.roster.sessions.spendSummary(),
        window.roster.sessions.recentByAgent(),
      ])
      useRoster.getState().setSpend(spend)
      useRoster.getState().setTranscripts(transcripts)
    } catch (cause) {
      setDeleteError(messageFor(cause))
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header
        className="flex h-header flex-none items-center gap-[10px] border-b border-line px-[18px]"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div
          className="flex flex-1 items-center gap-[10px]"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={() => go('grid')}
            className="cursor-pointer border-0 bg-transparent p-0 font-ui text-md text-dim hover:text-ink"
            data-hoverable
          >
            Agents
          </button>
          <span aria-hidden className="text-line-hover-strong">
            /
          </span>
          <StatusDot status={status} size={7} />
          <span className="font-semibold">{agent.name}</span>
          <span className="font-mono text-sm text-dim-2">{agent.model}</span>

          <div className="ml-auto">
            <Segmented
              ariaLabel="Pane"
              options={MODES}
              value={mode}
              onChange={(value: PaneMode) => setMode(value)}
            />
          </div>
        </div>
      </header>

      <SessionTabs
        sessions={sessions}
        activeId={activeId ?? null}
        onSelect={(id) => selectSession(agent.id, id)}
        onNew={() => void newSession()}
        onDelete={(id) => void deleteSession(id)}
      />

      {deleteError === null ? null : (
        <p
          role="alert"
          className="m-0 flex-none border-b border-line bg-sunken px-[18px] py-[6px] text-md text-error"
        >
          {deleteError}
        </p>
      )}

      {/* The banner is for commands only; a question is answered where it was
          asked. With both pending, both are shown. */}
      {pending && activeId ? <ApprovalBanner sessionId={activeId} approval={pending} /> : null}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {!active ? (
            <EmptyPane onNew={() => void newSession()} />
          ) : mode === 'chat' ? (
            <AssistantChatPane
              sessionId={active.id}
              agentName={agent.name}
              messages={messages}
              isStreaming={streaming}
              streamingText={activity ?? `${agent.name} is working…`}
              skillsLine={`skills: ${agent.skills.join(', ') || 'none'}`}
              {...(asking !== null && questioning?.sessionId === active.id
                ? { questions: asking }
                : {})}
              onAnswer={respondToQuestion}
              // Allowed, not denied: the tool's own answer for this is that
              // nobody replied, which is truer than an error.
              onSkipQuestions={() => respondToQuestion({})}
              planMode={planMode[active.id] === true}
              onTogglePlanMode={() => togglePlanMode(active.id)}
              onSend={(prompt) =>
                void window.roster.sessions.send(active.id, prompt, {
                  planMode: planMode[active.id] === true,
                })
              }
              onCancel={() => void window.roster.sessions.cancel(active.id)}
            />
          ) : (
            <TerminalPane sessionId={active.id} cwd={agent.cwd} cwdLabel={agent.cwdLabel} />
          )}
        </div>

        <ConfigRail agent={agent} />
      </div>

      {editOpen ? <EditAgentModal agent={agent} /> : null}
      {/* Plans belong to a session, so this is where they are read. */}
      {openPlanId === null ? null : <PlanModal />}
    </div>
  )
}

interface SessionTabsProps {
  sessions: readonly Session[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

function SessionTabs({ sessions, activeId, onSelect, onNew, onDelete }: SessionTabsProps) {
  return (
    <div className="flex flex-none items-stretch gap-[4px] overflow-x-auto border-b border-line bg-sunken px-[12px] py-[6px]">
      {sessions.map((session) => (
        <SessionTab
          key={session.id}
          session={session}
          active={session.id === activeId}
          onSelect={() => onSelect(session.id)}
          onDelete={() => onDelete(session.id)}
        />
      ))}

      <button
        type="button"
        onClick={onNew}
        className="flex cursor-pointer items-center rounded-pill border border-dashed border-line-dashed bg-transparent px-[11px] py-[5px] font-ui text-md whitespace-nowrap text-dim hover:border-[#55596a] hover:text-ink-3"
        data-hoverable
      >
        + New session
      </button>
    </div>
  )
}

interface SessionTabProps {
  session: Session
  active: boolean
  onSelect: () => void
  onDelete: () => void
}

/**
 * One tab, and the only place a session can be destroyed from.
 *
 * The delete control is a sibling of the tab rather than a child of it —
 * a button inside a button is not valid, and a click on it must not also
 * select the tab it sits in. It stays out of the way until the tab is
 * hovered or something in it has focus, so the strip does not read as a row
 * of close buttons.
 */
function SessionTab({ session, active, onSelect, onDelete }: SessionTabProps) {
  return (
    <div
      className={`group flex items-center rounded-pill border pr-[6px] whitespace-nowrap hover:bg-[#1a1c23] ${
        active
          ? 'border-line-active bg-[#1c1e26] text-ink'
          : 'border-transparent bg-transparent text-muted-2'
      }`}
    >
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        onClick={onSelect}
        className="flex cursor-pointer items-center gap-[8px] border-0 bg-transparent px-[11px] py-[5px] font-ui text-inherit"
        data-hoverable
      >
        <span
          aria-hidden
          className="text-sm"
          style={{
            color: session.origin === 'agent' ? 'var(--color-accent-light)' : 'var(--color-faint)',
          }}
        >
          {session.origin === 'agent' ? '↳' : '•'}
        </span>
        <span className="text-md font-medium">{sessionLabel(session)}</span>
        <span className="text-xs text-faint">{session.from ?? 'you'}</span>
        <StatusDot status={session.status} />
      </button>

      <button
        type="button"
        aria-label={`Delete session ${sessionLabel(session)}`}
        title="Delete session"
        onClick={onDelete}
        className="cursor-pointer rounded-full border-0 bg-transparent px-[5px] py-0 font-ui text-md leading-none text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-error"
        data-hoverable
      >
        ×
      </button>
    </div>
  )
}

interface ApprovalBannerProps {
  sessionId: string
  approval: Approval
}

function ApprovalBanner({ sessionId, approval }: ApprovalBannerProps) {
  const setPlanMode = useRoster((s) => s.setPlanMode)
  const openPlan = useRoster((s) => s.openPlan)
  const isPlan = approval.toolName === EXIT_PLAN_MODE
  const planId = approval.planId

  function respond(approved: boolean): void {
    void window.roster.sessions.respondToApproval(sessionId, approval.id, approved)
    // Approving the plan is the moment the agent is meant to start work, so
    // the next turn must not refuse to edit. Denying keeps planning.
    if (isPlan && approved) setPlanMode(sessionId, false)
  }

  return (
    <div className="flex flex-none items-center gap-[12px] border-b border-amber-line bg-amber-surface px-[18px] py-[10px]">
      <span aria-hidden className="h-[6px] w-[6px] flex-none rounded-full bg-amber" />
      <p className="m-0 truncate text-lg text-amber-text">
        {isPlan ? (
          <>
            Waiting on you — agent has a plan: <span className="font-mono">{approval.command}</span>
          </>
        ) : (
          <>
            Waiting on you — agent wants to run{' '}
            <span className="font-mono">{approval.command}</span>
          </>
        )}
      </p>
      <div className="ml-auto flex gap-[7px]">
        {planId === undefined ? null : (
          <button
            type="button"
            onClick={() => openPlan(planId)}
            className="cursor-pointer rounded-chip border border-amber-line bg-transparent px-[11px] py-[4px] font-ui text-md text-amber-text hover:border-amber"
            data-hoverable
          >
            Review plan
          </button>
        )}
        <button
          type="button"
          onClick={() => respond(false)}
          className="cursor-pointer rounded-chip border border-line-hover-strong bg-transparent px-[11px] py-[4px] font-ui text-md text-ink-4 hover:border-[#55596a]"
          data-hoverable
        >
          {isPlan ? 'Keep planning' : 'Deny'}
        </button>
        <button
          type="button"
          onClick={() => respond(true)}
          className="cursor-pointer rounded-chip border-0 bg-amber px-[11px] py-[4px] font-ui text-md font-semibold text-amber-ink hover:bg-amber-hover"
          data-hoverable
        >
          {isPlan ? 'Start work' : 'Approve'}
        </button>
      </div>
    </div>
  )
}

function EmptyPane({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[10px]">
      <p className="m-0 text-md text-dim">No sessions on this agent yet.</p>
      <button
        type="button"
        onClick={onNew}
        className="cursor-pointer rounded-chip border-0 bg-accent px-[11px] py-[5px] font-ui text-md font-semibold text-white hover:bg-accent-hover"
      >
        New session
      </button>
    </div>
  )
}

function ConfigRail({ agent }: { agent: Agent }) {
  const go = useRoster((s) => s.go)
  const openEdit = useRoster((s) => s.openEdit)

  const rows: { key: string; value: string }[] = [
    { key: 'Runner', value: agent.runner },
    { key: 'Model', value: agent.model },
    { key: 'Directory', value: agent.cwdLabel },
    { key: 'Config', value: 'agent.toml' },
    { key: 'MCP', value: agent.mcpServers.join(', ') || 'none' },
  ]

  return (
    <aside className="flex w-rail flex-none flex-col gap-[18px] overflow-y-auto border-l border-line bg-rail px-[16px] pt-[16px] pb-[24px]">
      <section className="flex flex-col gap-[9px]">
        <div className="flex items-center">
          <SectionLabel>Configuration</SectionLabel>
          <button
            type="button"
            onClick={openEdit}
            className="ml-auto cursor-pointer rounded-sm border border-line-input bg-transparent px-[9px] py-[2px] font-ui text-sm text-ink-3 hover:border-[#55596a]"
            data-hoverable
          >
            Edit
          </button>
        </div>
        {rows.map((row) => (
          <div key={row.key} className="flex items-baseline gap-[10px]">
            <span className="w-[74px] flex-none text-base text-dim">{row.key}</span>
            <span className="truncate font-mono text-md text-ink-2">{row.value}</span>
          </div>
        ))}
        {agent.status === 'error' ? (
          <p className="m-0 text-base leading-[1.5] text-error">{agent.statusDetail}</p>
        ) : null}
      </section>

      <section className="flex flex-col gap-[9px]">
        <div className="flex items-center">
          <SectionLabel>Skills</SectionLabel>
          <button
            type="button"
            onClick={() => go('skills')}
            className="ml-auto cursor-pointer border-0 bg-transparent p-0 font-ui text-sm text-accent-light"
          >
            Manage
          </button>
        </div>
        {agent.skills.length === 0 ? (
          <p className="m-0 text-md text-dim">None enabled.</p>
        ) : (
          agent.skills.map((skill) => (
            <div
              key={skill}
              className="flex items-center gap-[8px] rounded-chip border border-line bg-card px-[9px] py-[6px]"
            >
              <span aria-hidden className="h-[5px] w-[5px] rounded-[1.5px] bg-accent" />
              <span className="text-md text-ink-3">{skill}</span>
            </div>
          ))
        )}
      </section>

      <SessionTask />
      <SessionCard />
    </aside>
  )
}

/**
 * The task this session was opened to answer.
 *
 * The mirror of the Sessions row on a task's own rail: from there you reach
 * the transcript, from here you get back to the work. Absent for a session
 * nobody opened from a task — and absent again once that task is deleted,
 * since the column carrying this is set to null rather than cascading, so a
 * transcript outlives the task but stops claiming to belong to it.
 *
 * Above the Session card deliberately: what the session is about reads
 * before what it has cost.
 */
function SessionTask() {
  const agentId = useRoster((s) => s.agentId)
  const activeId = useRoster((s) => (agentId ? s.sess[agentId] : undefined))
  const taskId = useRoster(
    (s) =>
      (agentId ? (s.sessions[agentId] ?? NO_SESSIONS) : NO_SESSIONS).find(
        (session) => session.id === activeId,
      )?.taskId ?? null,
  )
  // The key comes off the session, so the link works whether or not the
  // board has been read; only the title is the part that can be missing.
  const task = useRoster((s) => s.tasks.find((candidate) => candidate.id === taskId) ?? null)
  const go = useRoster((s) => s.go)
  const openTask = useRoster((s) => s.openTask)

  if (taskId === null) return null

  return (
    <section className="flex flex-col gap-[9px]">
      <SectionLabel>Task</SectionLabel>
      <button
        type="button"
        aria-label={`Open ${taskId}`}
        // The task first, so the board is already showing it when the screen
        // changes rather than for one frame showing no modal at all.
        onClick={() => {
          openTask(taskId)
          go('tasks')
        }}
        className="flex cursor-pointer flex-col gap-[5px] rounded-field border border-line bg-card p-[11px] text-left hover:border-line-hover-strong"
        data-hoverable
      >
        <div className="flex items-center gap-[7px]">
          <span
            aria-hidden
            className="h-[6px] w-[6px] flex-none rounded-full"
            style={{
              background: task ? taskStatusColor(task.status) : 'var(--color-muted-2)',
            }}
          />
          <span className="font-mono text-base text-dim">{taskId}</span>
        </div>
        {task ? <span className="text-md leading-[1.45] text-ink-2">{task.title}</span> : null}
      </button>
    </section>
  )
}

function SessionCard() {
  const agentId = useRoster((s) => s.agentId)
  const activeId = useRoster((s) => (agentId ? s.sess[agentId] : undefined))
  const session = useRoster(
    (s) =>
      (agentId ? (s.sessions[agentId] ?? NO_SESSIONS) : NO_SESSIONS).find(
        (candidate) => candidate.id === activeId,
      ) ?? null,
  )
  const usage = useRoster((s) => (activeId ? s.usage[activeId] : undefined))
  const model = useRoster((s) => s.agents.find((a) => a.id === agentId)?.model ?? '')

  // Zeros here would read as "this session has cost nothing", which is a
  // different claim from "no session is open".
  if (activeId === undefined) {
    return (
      <section className="flex flex-col gap-[9px]">
        <SectionLabel>Session</SectionLabel>
        <div className="rounded-field border border-line bg-card p-[11px] text-base text-dim">
          No session open.
        </div>
      </section>
    )
  }

  // The same figure the grid cards show — cache included, which on Claude is
  // most of a turn.
  const tokens = usage?.totalTokens ?? 0
  // Asked here rather than trusted from the stored fraction, which cannot
  // distinguish "window unknown" from "window empty".
  const fraction = contextFraction(model, tokens)

  return (
    <section className="flex flex-col gap-[9px]">
      <SectionLabel>Session</SectionLabel>
      {/* Above the totals, and keyed by session: what it is called reads
          before what it has cost, and switching tabs starts a clean draft. */}
      {session === null ? null : <SessionName key={session.id} session={session} />}
      <div className="flex flex-col gap-[7px] rounded-field border border-line bg-card p-[11px]">
        <div className="flex items-baseline">
          <span className="text-base text-dim">Tokens</span>
          <span className="ml-auto font-mono text-md">{tokens.toLocaleString()}</span>
        </div>
        <div className="flex items-baseline">
          <span className="text-base text-dim">Spend</span>
          <span className="ml-auto font-mono text-md text-amber">
            ${(usage?.costUsd ?? 0).toFixed(2)}
          </span>
        </div>
        {fraction === null ? (
          // No bar at all: an empty one reads as "plenty of room left", which
          // is a claim Roster cannot make about a model it does not know.
          <span className="text-xs text-faint-2">context window unknown for {model}</span>
        ) : (
          <>
            <div className="mt-[2px] h-[4px] overflow-hidden rounded-[2px] bg-line">
              <div className="h-full bg-accent" style={{ width: `${fraction * 100}%` }} />
            </div>
            <span className="text-xs text-faint-2">
              {contextLabel(fraction)} of context window
            </span>
          </>
        )}
      </div>

      <SessionProject sessionId={activeId} />
    </section>
  )
}

/**
 * Which project this session's work belongs to.
 *
 * Nothing infers it — the roster's own agents share working directories, so
 * a cwd says nothing about which piece of work a session is. This is the one
 * place a session gets a project, and it is what the Agents Grid filter
 * reads.
 */
function SessionProject({ sessionId }: { sessionId: string }) {
  const agentId = useRoster((s) => s.agentId)
  const current = useRoster((s) =>
    (agentId ? (s.sessions[agentId] ?? NO_SESSIONS) : NO_SESSIONS).find(
      (session) => session.id === sessionId,
    ),
  )
  // The session's own project stays listed even once archived, so a session
  // filed under one does not read as unfiled.
  const projectOptions = useRoster(
    useShallow((s) => projectPickerProjects(s, current?.projectId ?? null)),
  )
  const replaceSession = useRoster((s) => s.replaceSession)

  if (projectOptions.length === 0) return null

  async function choose(value: string): Promise<void> {
    const projectId = value === NO_PROJECT ? null : value
    const updated = await window.roster.sessions.setProject(sessionId, projectId)

    replaceSession(updated)
  }

  return (
    <div className="flex flex-col gap-[7px]">
      <span className="text-base text-dim">Project</span>
      <Select
        ariaLabel="Session project"
        value={current?.projectId ?? NO_PROJECT}
        onChange={(value) => void choose(value)}
        options={[
          { value: NO_PROJECT, label: 'No project' },
          ...projectOptions.map((project) => ({
            value: project.id,
            label: projectOptionLabel(project),
          })),
        ]}
      />
    </div>
  )
}
