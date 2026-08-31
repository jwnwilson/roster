import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import type { Plan, PlanComment, PlanStatus } from '@shared/types'
import { PLANS_SERVER } from '@shared/mcp'
import { Markdown } from '../components/Markdown'
import { Modal, SectionLabel } from '../components/primitives'
import { messageFor } from '../lib/errors'
import { quoteFromSelection } from '../lib/selection'
import { NO_PLAN_COMMENTS, useRoster } from '../state/store'

/** Wide enough for a plan to read as a document rather than as a column. */
const MODAL_WIDTH = 860

/** What each state is waiting on, said in the agent's name. */
const WAITING: Record<Exclude<PlanStatus, 'draft'>, string> = {
  revising: 'is revising this plan',
  building: 'is building this plan',
  in_review: 'has opened a pull request',
}

/**
 * A plan, rendered and answerable.
 *
 * The plan an agent proposes used to survive only as the arguments of one
 * tool call, shown as raw text in a collapsed panel. Here it is the document
 * it always was: rendered, kept, and with somewhere to reply.
 */
export function PlanModal() {
  const planId = useRoster((s) => s.openPlanId)
  const closePlan = useRoster((s) => s.closePlan)

  if (planId === null) return null
  return <PlanBody planId={planId} onClose={closePlan} />
}

interface PlanBodyProps {
  planId: string
  onClose: () => void
}

function PlanBody({ planId, onClose }: PlanBodyProps) {
  const document = useRoster(useShallow((s) => s.plans[planId]))
  const thread = useRoster(useShallow((s) => s.planComments[planId] ?? NO_PLAN_COMMENTS))
  const agents = useRoster(useShallow((s) => s.agents))
  const setPlan = useRoster((s) => s.setPlan)
  const setPlanComments = useRoster((s) => s.setPlanComments)

  const [text, setText] = useState('')
  const [quote, setQuote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const planRef = useRef<HTMLElement | null>(null)

  // Re-read on the version rather than only on mount: the agent rewriting the
  // plan while it is open changes the row, and only the store has the body.
  const version = document?.plan.version
  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      try {
        const [read, comments] = await Promise.all([
          window.roster.plans.read(planId),
          window.roster.plans.comments(planId),
        ])
        if (cancelled) return
        setPlan(read)
        setPlanComments(planId, comments)
      } catch (cause) {
        if (!cancelled) setError(messageFor(cause))
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [planId, version, setPlan, setPlanComments])

  if (!document) return null

  const { plan, body } = document
  const agent = agents.find((candidate) => candidate.id === plan.agentId)
  const agentName = agent?.name ?? 'The agent'
  const canReport = agent?.mcpServers.includes(PLANS_SERVER) === true

  /** Both actions hand the plan back to its agent, so both close the modal. */
  async function act(run: () => Promise<Plan>, after: () => void): Promise<void> {
    setError(null)
    setBusy(true)
    try {
      setPlan({ ...document!, plan: await run() })
      after()
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      setBusy(false)
    }
  }

  const note = text.trim()

  return (
    <Modal
      label={`Plan: ${plan.title}`}
      onClose={onClose}
      maxWidth={MODAL_WIDTH}
      fixedHeight
      header={
        <div className="flex min-w-0 items-center gap-[10px]">
          <h2 className="m-0 truncate text-xl font-semibold tracking-[-0.01em]">{plan.title}</h2>
          <span className="flex-none font-mono text-base text-dim-2">v{plan.version}</span>
          <StatusChip status={plan.status} />
        </div>
      }
      footer={
        plan.status === 'draft' ? (
          <>
            {canReport ? null : (
              <span className="text-sm text-faint">
                Enable the “{PLANS_SERVER}” server on {agentName} for the pull request to be
                linked here.
              </span>
            )}
            <div className="ml-auto flex flex-none gap-[8px]">
              <button
                type="button"
                disabled={busy || note === ''}
                onClick={() =>
                  void act(
                    () => window.roster.plans.submit(plan.id, note, quote ?? undefined),
                    () => {
                      setText('')
                      setQuote(null)
                    },
                  )
                }
                className="cursor-pointer rounded-chip border border-line-input bg-transparent px-[12px] py-[6px] font-ui text-md text-muted hover:border-line-hover disabled:cursor-default disabled:opacity-50"
              >
                Send comments
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(() => window.roster.plans.approve(plan.id), onClose)}
                className="cursor-pointer rounded-chip border-0 bg-accent px-[12px] py-[6px] font-ui text-md font-semibold text-white hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
              >
                Approve &amp; build
              </button>
            </div>
          </>
        ) : (
          <Waiting plan={plan} agentName={agentName} />
        )
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-[22px] py-[20px]">
          {/* Selecting inside here is how a note gets attached to a passage.
              Both mouse and keyboard, since a selection can be made either
              way, and a bare click clears it so the chip agrees with what is
              highlighted on screen. */}
          <section
            aria-label="Plan"
            ref={planRef}
            onMouseUp={() => setQuote(quoteFromSelection(window.getSelection(), planRef.current))}
            onKeyUp={() => setQuote(quoteFromSelection(window.getSelection(), planRef.current))}
          >
            <Markdown>{body}</Markdown>
          </section>

          <div className="h-[1px] flex-none bg-line" />

          <Thread comments={thread} />
        </div>

        <div className="flex flex-none flex-col gap-[8px] border-t border-line px-[22px] py-[12px]">
          {error === null ? null : <p className="m-0 text-md text-error">{error}</p>}
          {quote === null ? null : (
            <div className="flex items-start gap-[8px] rounded-field border border-accent-line bg-accent-surface px-[10px] py-[6px]">
              <span className="flex-none text-sm text-dim">On</span>
              <Quote>{quote}</Quote>
              <button
                type="button"
                aria-label="Clear the selected passage"
                onClick={() => setQuote(null)}
                className="ml-auto flex-none cursor-pointer border-0 bg-transparent p-0 font-ui text-[13px] leading-none text-dim hover:text-ink"
                data-hoverable
              >
                ×
              </button>
            </div>
          )}
          <textarea
            aria-label="Add a comment"
            placeholder={quote === null ? 'What should change?' : 'What should change about it?'}
            value={text}
            rows={3}
            onChange={(e) => setText(e.target.value)}
            // Modal listens for Escape on the window; without this, pressing
            // it to dismiss the field closes the dialog and loses the draft.
            onKeyDown={(e) => e.stopPropagation()}
            className="w-full resize-y rounded-field border border-line-card bg-card px-[10px] py-[8px] font-ui text-md leading-[1.55] text-ink outline-none placeholder:text-faint focus:border-accent-line focus:bg-accent-surface-2"
          />
        </div>
      </div>
    </Modal>
  )
}

/** What the plan is waiting on, once it is no longer waiting on you. */
function Waiting({ plan, agentName }: { plan: Plan; agentName: string }) {
  if (plan.status === 'in_review' && plan.prUrl !== undefined) {
    return (
      <a
        href={plan.prUrl}
        target="_blank"
        rel="noreferrer"
        className="text-md text-accent-light"
      >
        Open the pull request
      </a>
    )
  }

  return (
    // A status region: what it says changes underneath the reader as the
    // agent works, and it is the only thing here that does.
    <span role="status" className="text-md text-dim">
      {agentName} {WAITING[plan.status as Exclude<PlanStatus, 'draft'>]}
      {plan.branch === undefined ? '' : ' on '}
      {plan.branch === undefined ? null : (
        <span className="font-mono text-base text-muted-2">{plan.branch}</span>
      )}
      .
    </span>
  )
}

/**
 * A passage of the plan, quoted.
 *
 * A real <q>: this is a quotation of another part of the document, and the
 * thread and the composer chip should render it identically so that what you
 * are about to say and what you said before look like the same kind of thing.
 */
function Quote({ children }: { children: string }) {
  return (
    <q className="border-l-2 border-accent-line pl-[8px] text-sm leading-[1.5] text-muted-2 before:content-none after:content-none">
      {children}
    </q>
  )
}

function StatusChip({ status }: { status: PlanStatus }) {
  const label = status === 'in_review' ? 'In review' : status[0]!.toUpperCase() + status.slice(1)

  return (
    <span className="flex-none rounded-pill border border-line-card px-[8px] py-[2px] text-sm text-muted-2">
      {label}
    </span>
  )
}

function Thread({ comments }: { comments: readonly PlanComment[] }) {
  return (
    <section className="flex flex-none flex-col gap-[10px]">
      <SectionLabel>Comments</SectionLabel>

      {comments.length === 0 ? (
        <p className="m-0 text-md text-dim">No comments yet.</p>
      ) : (
        comments.map((comment) => (
          <div key={comment.id} className="flex flex-col gap-[3px]">
            <span
              className="text-sm font-medium"
              style={{
                color: comment.tone === 'agent' ? 'var(--color-accent-light)' : 'var(--color-muted-2)',
              }}
            >
              {comment.author}
            </span>
            {comment.quote === undefined ? null : <Quote>{comment.quote}</Quote>}
            <span className="text-md leading-[1.55] text-ink-2">{comment.text}</span>
          </div>
        ))
      )}
    </section>
  )
}
