import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import type { Agent } from '@shared/types'
import { Modal, StatusDot, TextInput, ToggleChip } from '@/components/primitives'
import { messageFor } from '@/lib/errors'
import { agentStatus, useRoster } from '@/state/store'

interface ManageAgentsModalProps {
  onClose: () => void
}

/**
 * Rows per page. One more than the Projects modal shows, because an agent row
 * is a single line where a project row carries a description under it — the
 * two end up about the same height, and a full page still fits inside the
 * card's floor without scrolling.
 */
const PAGE_SIZE = 6

/** Matching the Projects modal, so the two management surfaces sit still alike. */
const MODAL_WIDTH = 640
const MODAL_MIN_HEIGHT = 520

/**
 * The whole roster, with a Shown/Hidden toggle per agent.
 *
 * This is the one surface that lists hidden agents — everywhere else that
 * would show them is exactly what hiding turns off, so without it a hidden
 * agent would have no way back.
 */
export function ManageAgentsModal({ onClose }: ManageAgentsModalProps) {
  const agents = useRoster(useShallow((s) => s.agents))

  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const matching = useMemo(() => matchingAgents(agents, query), [agents, query])

  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE))
  // An agent leaving the last page — deleted by hand, or renamed out of the
  // filter — would otherwise leave you staring at an empty one.
  const current = Math.min(page, pageCount - 1)
  const visible = matching.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE)

  const filtering = query.trim() !== ''
  const hidden = agents.filter((agent) => agent.hidden).length

  async function setHidden(agent: Agent, next: boolean): Promise<void> {
    setError(null)
    try {
      await window.roster.agents.update(agent.id, { hidden: next })
      // Re-read rather than patch locally, so the list reflects the file
      // rather than what we hoped the write did.
      useRoster.setState({ agents: await window.roster.agents.list() })
    } catch (cause) {
      setError(messageFor(cause))
    }
  }

  function changeQuery(next: string): void {
    setQuery(next)
    // A page number from the old list means nothing against the new one.
    setPage(0)
  }

  return (
    <Modal
      label="Manage agents"
      onClose={onClose}
      maxWidth={MODAL_WIDTH}
      minHeight={MODAL_MIN_HEIGHT}
      header={<h2 className="m-0 text-2xl font-semibold">Manage agents</h2>}
      footer={
        pageCount > 1 ? (
          <>
            <span className="text-md text-dim">
              Page {current + 1} of {pageCount}
            </span>
            <div className="ml-auto flex gap-[8px]">
              <PageButton
                label="Previous"
                onClick={() => setPage(current - 1)}
                disabled={current === 0}
              />
              <PageButton
                label="Next"
                onClick={() => setPage(current + 1)}
                disabled={current === pageCount - 1}
              />
            </div>
          </>
        ) : undefined
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-none items-center gap-[10px] border-b border-line px-[18px] py-[10px]">
          <TextInput
            ariaLabel="Filter agents"
            placeholder="Filter agents"
            value={query}
            onChange={changeQuery}
            className="w-[220px]"
          />
          <span className="text-md text-dim">
            {summarise(matching.length, agents.length, hidden, filtering)}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-[8px] overflow-y-auto px-[18px] py-[14px]">
          {visible.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              onToggle={() => void setHidden(agent, !agent.hidden)}
            />
          ))}

          {matching.length === 0 ? (
            <p className="m-0 text-md text-dim">
              {filtering ? 'No agents match.' : 'No agents configured yet.'}
            </p>
          ) : null}

          {error ? <p className="m-0 text-md text-error">{error}</p> : null}
        </div>
      </div>
    </Modal>
  )
}

/** Name, runner or model, case-insensitively — the three things a row shows. */
function matchingAgents(agents: readonly Agent[], query: string): readonly Agent[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return agents

  return agents.filter(
    (agent) =>
      agent.name.toLowerCase().includes(needle) ||
      agent.runner.toLowerCase().includes(needle) ||
      agent.model.toLowerCase().includes(needle),
  )
}

/** The count line, said in the way that fits what the list is currently doing. */
function summarise(matched: number, total: number, hidden: number, filtering: boolean): string {
  // A hidden agent can still match, so the filtered count is measured against
  // the whole roster rather than the visible part of it.
  if (filtering) return `${matched} of ${total} match`

  const roster = `${total} ${total === 1 ? 'agent' : 'agents'}`
  return hidden === 0 ? roster : `${roster} · ${hidden} hidden`
}

interface PageButtonProps {
  label: string
  onClick: () => void
  disabled: boolean
}

function PageButton({ label, onClick, disabled }: PageButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer rounded-sm border border-line-input bg-transparent px-[9px] py-[3px] font-ui text-sm text-ink-3 hover:border-line-hover-strong disabled:cursor-default disabled:opacity-40"
      data-hoverable
    >
      {label}
    </button>
  )
}

interface AgentRowProps {
  agent: Agent
  onToggle: () => void
}

function AgentRow({ agent, onToggle }: AgentRowProps) {
  const status = useRoster((s) => agentStatus(s, agent))

  return (
    <div className="flex flex-none items-center gap-[9px] rounded-[9px] border border-line px-[13px] py-[10px]">
      <StatusDot status={status} />
      <span className="truncate text-xl font-semibold">{agent.name}</span>
      <span className="truncate font-mono text-xs text-dim-2">
        {agent.runner} · {agent.model}
      </span>
      <div className="ml-auto flex-none">
        <ToggleChip
          // The label is the state, so the button needs a name of its own or
          // it reads as "Shown, pressed".
          ariaLabel={`Show ${agent.name}`}
          label={agent.hidden ? 'Hidden' : 'Shown'}
          on={!agent.hidden}
          onToggle={onToggle}
          dotShape="circle"
        />
      </div>
    </div>
  )
}
