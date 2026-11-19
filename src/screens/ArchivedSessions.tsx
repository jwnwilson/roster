import { useEffect, useState } from 'react'
import { ScreenHeader } from '@/components/primitives'
import { messageFor } from '@/lib/errors'
import { relativeTime } from '@/state/format'
import { reduceSessionEvent, useRoster } from '@/state/store'
import { sessionLabel } from '@shared/sessions'
import type { Session } from '@shared/types'

/**
 * Sessions that have been put away.
 *
 * The only place a session can be permanently deleted from. Restoring is the
 * everyday action; deleting is for cleaning up what is no longer wanted, and
 * is confirmed in the main process before anything is removed.
 */
export function ArchivedSessions() {
  const agents = useRoster((s) => s.agents)
  const [archived, setArchived] = useState<Session[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      void window.roster.sessions.listArchived().then((loaded) => {
        if (!cancelled) setArchived(loaded)
      })
    load()

    // An agent can archive, or a person elsewhere can restore, while this
    // view is open. Re-read rather than patch: the list is short, and the
    // server's order is the one that counts.
    const stop = window.roster.sessions.onEvent((event) => {
      if (
        event.type === 'session-archived' ||
        event.type === 'session-restored' ||
        event.type === 'session-deleted'
      ) {
        load()
      }
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  /** Takes a row off this list. The store is told separately, by the event. */
  function forget(sessionId: string): void {
    setArchived((current) => (current ?? []).filter((session) => session.id !== sessionId))
  }

  async function restore(session: Session): Promise<void> {
    setError(null)
    try {
      await window.roster.sessions.restore(session.id)
      // Applied now as well as by the broadcast, so the row goes at once and
      // the agent's list shows it on return. Applying it twice is safe.
      const restored = { ...session, archivedAt: null }
      useRoster.setState((state) => reduceSessionEvent(state, { type: 'session-restored', session: restored }))
      forget(session.id)
    } catch (cause) {
      setError(messageFor(cause))
    }
  }

  async function deletePermanently(session: Session): Promise<void> {
    setError(null)
    try {
      const deleted = await window.roster.sessions.remove(session.id)
      if (!deleted) return
      useRoster.setState((state) =>
        reduceSessionEvent(state, { type: 'session-deleted', sessionId: session.id, agentId: session.agentId }),
      )
      forget(session.id)
    } catch (cause) {
      setError(messageFor(cause))
    }
  }

  const rows = archived ?? []

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Archived">
        <span className="text-md text-dim">
          Kept with their transcripts and spend. Restore one to bring it back to its agent.
        </span>
      </ScreenHeader>

      {error === null ? null : (
        <p role="alert" className="m-0 flex-none border-b border-line bg-sunken px-[18px] py-[6px] text-md text-error">
          {error}
        </p>
      )}

      {archived !== null && rows.length === 0 ? (
        <p className="m-0 px-[18px] py-[18px] text-md text-dim">Nothing is archived.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-[1px] overflow-y-auto p-[12px]">
          {rows.map((session) => {
            const label = sessionLabel(session)
            const agent = agents.find((candidate) => candidate.id === session.agentId)
            return (
              <li
                key={session.id}
                aria-label={label}
                className="flex items-center gap-[12px] rounded-chip px-[12px] py-[8px] hover:bg-[#1a1c23]"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-xl text-ink">{label}</span>
                  <span className="text-sm text-dim-2">
                    {agent?.name ?? 'Unknown agent'}
                    {session.archivedAt ? ` · archived ${relativeTime(session.archivedAt)}` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label={`Restore session ${label}`}
                  onClick={() => void restore(session)}
                  className="cursor-pointer rounded-pill border border-line bg-transparent px-[11px] py-[4px] font-ui text-md text-ink-3 hover:border-[#55596a]"
                  data-hoverable
                >
                  Restore
                </button>
                <button
                  type="button"
                  aria-label={`Delete session ${label} permanently`}
                  onClick={() => void deletePermanently(session)}
                  className="cursor-pointer rounded-pill border border-line bg-transparent px-[11px] py-[4px] font-ui text-md text-dim hover:border-error hover:text-error"
                  data-hoverable
                >
                  Delete permanently
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
