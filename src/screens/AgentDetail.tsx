import { useEffect } from 'react'
import { useShallow } from 'zustand/shallow'
import type { Agent, Approval, Session } from '@shared/types'
import { statusColor } from '@shared/status'
import { AssistantChatPane } from '@/chat/AssistantChatPane'
import { EditAgentModal } from './EditAgentModal'
import { SectionLabel, Segmented, StatusDot } from '@/components/primitives'
import { TerminalPane } from '@/terminal/TerminalPane'
import { NO_SESSIONS, selectCurrentAgent, useRoster, type PaneMode } from '@/state/store'

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
  const selectSession = useRoster((s) => s.selectSession)
  const editOpen = useRoster((s) => s.editOpen)

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

    return () => {
      cancelled = true
    }
  }, [activeId, setMessages, setUsage])

  const active = sessions.find((s) => s.id === activeId) ?? null
  const pending = approvals[0] ?? null

  async function newSession(): Promise<void> {
    const created = await window.roster.sessions.create(agent.id)
    setSessions(agent.id, [...sessions, created])
    selectSession(agent.id, created.id)
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
          <StatusDot status={agent.status} size={7} />
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
      />

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
              onSend={(prompt) => void window.roster.sessions.send(active.id, prompt)}
              onCancel={() => void window.roster.sessions.cancel(active.id)}
            />
          ) : (
            <TerminalPane sessionId={active.id} cwd={agent.cwd} cwdLabel={agent.cwdLabel} />
          )}
        </div>

        <ConfigRail agent={agent} />
      </div>

      {editOpen ? <EditAgentModal agent={agent} /> : null}
    </div>
  )
}

interface SessionTabsProps {
  sessions: readonly Session[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}

function SessionTabs({ sessions, activeId, onSelect, onNew }: SessionTabsProps) {
  return (
    <div className="flex flex-none items-stretch gap-[4px] overflow-x-auto border-b border-line bg-sunken px-[12px] py-[6px]">
      {sessions.map((session) => {
        const on = session.id === activeId
        return (
          <button
            key={session.id}
            type="button"
            aria-current={on ? 'true' : undefined}
            onClick={() => onSelect(session.id)}
            className={`flex cursor-pointer items-center gap-[8px] rounded-pill border px-[11px] py-[5px] whitespace-nowrap hover:bg-[#1a1c23] ${
              on
                ? 'border-line-active bg-[#1c1e26] text-ink'
                : 'border-transparent bg-transparent text-muted-2'
            }`}
            data-hoverable
          >
            <span
              aria-hidden
              className="text-sm"
              style={{
                color:
                  session.origin === 'agent' ? 'var(--color-accent-light)' : 'var(--color-faint)',
              }}
            >
              {session.origin === 'agent' ? '↳' : '•'}
            </span>
            <span className="text-md font-medium">{session.title}</span>
            <span className="text-xs text-faint">{session.from ?? 'you'}</span>
            <StatusDot status={session.status} />
          </button>
        )
      })}

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

interface ApprovalBannerProps {
  sessionId: string
  approval: Approval
}

function ApprovalBanner({ sessionId, approval }: ApprovalBannerProps) {
  function respond(approved: boolean): void {
    void window.roster.sessions.respondToApproval(sessionId, approval.id, approved)
  }

  return (
    <div className="flex flex-none items-center gap-[12px] border-b border-amber-line bg-amber-surface px-[18px] py-[10px]">
      <span aria-hidden className="h-[6px] w-[6px] flex-none rounded-full bg-amber" />
      <p className="m-0 text-lg text-amber-text">
        Waiting on you — agent wants to run{' '}
        <span className="font-mono">{approval.command}</span>
      </p>
      <div className="ml-auto flex gap-[7px]">
        <button
          type="button"
          onClick={() => respond(false)}
          className="cursor-pointer rounded-chip border border-line-hover-strong bg-transparent px-[11px] py-[4px] font-ui text-md text-ink-4 hover:border-[#55596a]"
          data-hoverable
        >
          Deny
        </button>
        <button
          type="button"
          onClick={() => respond(true)}
          className="cursor-pointer rounded-chip border-0 bg-amber px-[11px] py-[4px] font-ui text-md font-semibold text-amber-ink hover:bg-amber-hover"
          data-hoverable
        >
          Approve
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

      <SessionCard />
    </aside>
  )
}

function SessionCard() {
  const agentId = useRoster((s) => s.agentId)
  const activeId = useRoster((s) => (agentId ? s.sess[agentId] : undefined))
  const usage = useRoster((s) => (activeId ? s.usage[activeId] : undefined))

  const tokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
  const percent = Math.round((usage?.contextUsed ?? 0) * 100)

  return (
    <section className="flex flex-col gap-[9px]">
      <SectionLabel>Session</SectionLabel>
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
        <div className="mt-[2px] h-[4px] overflow-hidden rounded-[2px] bg-line">
          <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
        </div>
        <span className="text-xs text-faint-2">{percent}% of context window</span>
      </div>
    </section>
  )
}
