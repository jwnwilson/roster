import { useState } from 'react'
import { useShallow } from 'zustand/shallow'
import type { Agent } from '@shared/types'
import { Modal, StatusDot, ToggleChip } from '@/components/primitives'
import { messageFor } from '@/lib/errors'
import { agentStatus, useRoster } from '@/state/store'

interface ManageAgentsModalProps {
  onClose: () => void
}

/**
 * The whole roster, with a Shown/Hidden toggle per agent.
 *
 * This is the one surface that lists hidden agents — everywhere else that
 * would show them is exactly what hiding turns off, so without it a hidden
 * agent would have no way back.
 */
export function ManageAgentsModal({ onClose }: ManageAgentsModalProps) {
  const agents = useRoster(useShallow((s) => s.agents))
  const [error, setError] = useState<string | null>(null)

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

  return (
    <Modal
      label="Manage agents"
      onClose={onClose}
      header={
        <>
          <h2 className="m-0 text-2xl font-semibold">Manage agents</h2>
          <span className="text-md text-dim">
            {hidden === 0 ? `${agents.length} on the roster` : `${hidden} hidden`}
          </span>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-[8px] overflow-y-auto px-[18px] py-[14px]">
        {agents.length === 0 ? (
          <p className="m-0 text-md text-dim">No agents configured yet.</p>
        ) : (
          agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} onToggle={() => void setHidden(agent, !agent.hidden)} />
          ))
        )}

        {error ? <p className="m-0 text-md text-error">{error}</p> : null}
      </div>
    </Modal>
  )
}

interface AgentRowProps {
  agent: Agent
  onToggle: () => void
}

function AgentRow({ agent, onToggle }: AgentRowProps) {
  const status = useRoster((s) => agentStatus(s, agent))

  return (
    <div className="flex items-center gap-[9px] rounded-[9px] border border-line px-[13px] py-[10px]">
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
