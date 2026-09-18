import { useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import { SectionLabel } from '@/components/primitives'
import { useRoster } from '@/state/store'
import { flowEdges, flowOfSession } from '@/state/workflow'

/**
 * The rest of the flow this session is part of, on the Workflow canvas.
 *
 * The mirror of a task's own "View workflow", and deliberately the same
 * words: it is the same jump, arrived at from the other end. From the task
 * you ask which agents took the work; from here you ask who else is on it.
 *
 * The canvas filters by task, and a handed-off session does not inherit its
 * parent's — so the task is walked to rather than read off this session.
 * A chain no mention ever opened has no task to filter by, and the control
 * stays, disabled, saying so: that the canvas is organised around tasks is
 * the useful answer there, and one nothing else on this rail gives. A
 * session with no chain and no task has no flow at all and says nothing.
 */
export function SessionWorkflowLink() {
  const agentId = useRoster((s) => s.agentId)
  const sessionId = useRoster((s) => (agentId ? s.sess[agentId] : undefined)) ?? null
  // Every session, not this agent's: the chain runs across agents, which is
  // the whole reason to follow it.
  const sessions = useRoster(useShallow((s) => Object.values(s.sessions).flat()))
  const openWorkflowForTask = useRoster((s) => s.openWorkflowForTask)

  const flow = useMemo(
    () => (sessionId === null ? null : flowOfSession(sessions, flowEdges(sessions), sessionId)),
    [sessions, sessionId],
  )
  const task = useRoster(
    (s) => s.tasks.find((candidate) => candidate.id === flow?.taskId) ?? null,
  )

  const alone = flow === null || (flow.ids.size === 1 && flow.taskId === null)
  if (alone) return null

  function open(): void {
    if (task === null) return
    openWorkflowForTask(task)
  }

  return (
    <section className="flex flex-col gap-[9px]">
      <SectionLabel>Workflow</SectionLabel>
      <button
        type="button"
        disabled={task === null}
        onClick={open}
        className="cursor-pointer rounded-chip border border-line-input bg-transparent px-[8px] py-[4px] text-left text-base text-muted-2 hover:border-line-hover-strong hover:text-ink-3 disabled:cursor-not-allowed disabled:text-label disabled:hover:border-line-input disabled:hover:text-label"
        data-hoverable
      >
        View workflow
      </button>
      {task === null ? (
        <p className="m-0 text-base leading-[1.5] text-dim">
          No task opened this chain, so there is no flow to single out.
        </p>
      ) : null}
    </section>
  )
}
