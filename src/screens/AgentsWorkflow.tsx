import { useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import type { Session } from '@shared/types'
import { sessionLabel } from '@shared/sessions'
import { statusColor, statusLabel } from '@shared/status'
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  flowEdges,
  layoutFlow,
  visibleFlowIds,
} from '@/state/workflow'
import { agentStatus, archivedProjectIds, projectById, useRoster } from '@/state/store'

/**
 * The Agents screen's Workflow view: every session as a node, every handoff
 * as an edge, running left to right.
 *
 * This is how you follow one piece of work. A task's brief is handed from
 * agent to agent, and until now the only record of that was a pill at the top
 * of each transcript — you could see the step you were standing on but never
 * the shape of the whole thing.
 *
 * Sessions belonging to hidden agents are drawn too. Hiding keeps an agent
 * off the roster list and the Cards view; leaving one out here would break
 * the chain in the middle and lose everything downstream of it, which is the
 * one thing this view exists to show.
 */
/**
 * The graph the filters leave: which sessions, where they sit, and the paths
 * between them.
 *
 * A hook rather than a selector, because every value here is freshly built —
 * through `useRoster(selector)` that re-renders forever. Shared with the
 * header so its summary counts what is actually on the canvas.
 */
export function useWorkflowGraph() {
  const sessions = useRoster(useShallow((s) => Object.values(s.sessions).flat()))
  const projectFilter = useRoster((s) => s.projectFilter)
  const taskFilter = useRoster((s) => s.workflowTaskId)
  const archived = useRoster(useShallow(archivedProjectIds))

  return useMemo(() => {
    const edges = flowEdges(sessions)
    const visible = visibleFlowIds(sessions, edges, { projectFilter, taskFilter, archived })
    const shown = sessions.filter((session) => visible.has(session.id))
    const shownEdges = edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to))

    return { shown, ...layoutFlow(shown, shownEdges) }
  }, [sessions, projectFilter, taskFilter, archived])
}

/** What the header says over the graph, in the shape the Cards view uses. */
export function workflowSummary(shown: readonly Session[]): string {
  const running = shown.filter((session) => session.status === 'running').length
  const sessions = shown.length === 1 ? '1 session' : `${shown.length} sessions`
  return `${sessions} · ${running} running`
}

/** Passed down rather than recomputed, so the header and the canvas agree. */
interface AgentsWorkflowProps {
  graph: ReturnType<typeof useWorkflowGraph>
}

export function AgentsWorkflow({ graph }: AgentsWorkflowProps) {
  const openAgent = useRoster((s) => s.openAgent)

  if (graph.shown.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-[18px]">
        <p className="m-0 text-md text-dim">
          No sessions to show. Mention an agent on a task, or hand work to one, and the flow
          appears here.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-[24px]">
      <div
        role="group"
        aria-label="Session workflow"
        className="relative"
        style={{ width: graph.width, height: graph.height }}
      >
        <svg
          aria-hidden
          width={graph.width}
          height={graph.height}
          className="pointer-events-none absolute top-0 left-0 overflow-visible"
        >
          {graph.paths.map((d) => (
            <path
              key={d}
              d={d}
              fill="none"
              stroke="var(--color-accent-line)"
              strokeWidth={1.5}
            />
          ))}
        </svg>

        {graph.shown.map((session) => (
          <WorkflowNode
            key={session.id}
            session={session}
            x={graph.positions[session.id]?.x ?? 0}
            y={graph.positions[session.id]?.y ?? 0}
            onOpen={() => openAgent(session.agentId, session.id)}
          />
        ))}
      </div>
    </div>
  )
}

interface WorkflowNodeProps {
  session: Session
  x: number
  y: number
  onOpen: () => void
}

function WorkflowNode({ session, x, y, onOpen }: WorkflowNodeProps) {
  const agent = useRoster((s) => s.agents.find((candidate) => candidate.id === session.agentId))
  const agentTone = useRoster((s) => (agent ? agentStatus(s, agent) : 'idle'))
  const project = useRoster((s) => projectById(s, session.projectId ?? null))

  const name = agent?.name ?? session.agentId
  const label = sessionLabel(session)

  return (
    <button
      type="button"
      aria-label={`Open ${name} · ${label}`}
      onClick={onOpen}
      className="absolute z-[1] flex cursor-pointer flex-col gap-[5px] rounded-field border border-line-input bg-card px-[10px] py-[8px] text-left hover:border-line-hover-strong"
      style={{ left: x, top: y, width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
      data-hoverable
    >
      <div className="flex items-center gap-[6px]">
        <span
          aria-hidden
          className="size-[6px] flex-none rounded-full"
          style={{ background: statusColor(agentTone) }}
        />
        <span className="truncate text-[10.5px] font-semibold text-muted">{name}</span>
      </div>

      <div className="truncate text-[11.5px] text-ink-2">{label}</div>

      <div className="flex items-center gap-[8px]">
        <span
          className="text-[10px] font-medium"
          style={{ color: statusColor(session.status) }}
        >
          {statusLabel(session.status)}
        </span>
        {project ? (
          <span className="ml-auto flex min-w-0 items-center gap-[4px]">
            <span
              aria-hidden
              className="size-[5px] flex-none rounded-full"
              style={{ background: project.color }}
            />
            <span className="max-w-[80px] truncate text-[10px] text-muted-2">{project.name}</span>
          </span>
        ) : null}
      </div>

      {/* Only a session a mention opened carries a task; the ones its work
          was handed on to are found by following the edges instead. */}
      {session.taskId ? (
        <div className="font-mono text-[9.5px] text-dim-2">{session.taskId}</div>
      ) : null}
    </button>
  )
}
