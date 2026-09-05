import { useRef, useState, type KeyboardEvent } from 'react'
import { SESSION_NAME_MAX_LENGTH, isSessionNamed, normalizeSessionName } from '@shared/sessions'
import type { Session } from '@shared/types'
import { messageFor } from '@/lib/errors'
import { useRoster } from '@/state/store'

interface SessionNameProps {
  session: Session
}

/**
 * What you call this session.
 *
 * Three states, and the unnamed one is the point: it is a dashed "Name this
 * session" button rather than an empty field, because a field reads as
 * optional furniture and a button reads as something to do. The same
 * affordance opens by itself the moment a session is created — the nudge —
 * and closing it without typing leaves the session unnamed and working,
 * labelled by its title.
 *
 * Mount it with `key={session.id}` so switching sessions starts a fresh
 * draft rather than carrying the last one across.
 */
export function SessionName({ session }: SessionNameProps) {
  const naming = useRoster((s) => s.namingSessionId === session.id)
  const setNamingSession = useRoster((s) => s.setNamingSession)
  const replaceSession = useRoster((s) => s.replaceSession)

  const [draft, setDraft] = useState(session.name ?? '')
  const [error, setError] = useState<string | null>(null)
  // Enter saves and closes, which pulls the focused input out of the tree —
  // and that fires blur, which would save the same name a second time.
  const saving = useRef(false)

  function open(): void {
    setDraft(session.name ?? '')
    setError(null)
    saving.current = false
    setNamingSession(session.id)
  }

  function close(): void {
    setError(null)
    setNamingSession(null)
  }

  async function save(): Promise<void> {
    if (saving.current) return

    const next = normalizeSessionName(draft)
    // Nothing to write when the name has not changed — and a box closed
    // empty on an unnamed session is exactly that case, so walking away
    // costs nothing.
    if (next === normalizeSessionName(session.name)) {
      close()
      return
    }

    saving.current = true
    try {
      const updated = await window.roster.sessions.setName(session.id, next)
      replaceSession(updated)
      close()
    } catch (cause) {
      // Left open, showing why: closing would leave the rail claiming a name
      // the database never took.
      saving.current = false
      setError(messageFor(cause))
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      void save()
    }
    if (event.key === 'Escape') {
      // The edit is abandoned, not saved: Escape here must not also reach
      // anything behind the rail.
      event.stopPropagation()
      setDraft(session.name ?? '')
      close()
    }
  }

  if (naming) {
    return (
      <div className="flex flex-col gap-[5px]">
        <span className="text-base text-dim">Name</span>
        <input
          type="text"
          autoFocus
          aria-label="Session name"
          placeholder="What is this session for?"
          maxLength={SESSION_NAME_MAX_LENGTH}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => void save()}
          className="rounded-chip border border-accent-line bg-accent-surface-2 px-[9px] py-[5px] font-ui text-md text-ink outline-none placeholder:text-faint"
        />
        {error === null ? (
          <span className="text-xs text-faint-2">Enter to save, Escape to leave it unnamed.</span>
        ) : (
          <span className="text-xs text-error">{error}</span>
        )}
      </div>
    )
  }

  if (!isSessionNamed(session)) {
    return (
      <button
        type="button"
        onClick={open}
        className="cursor-pointer rounded-field border border-dashed border-accent-line bg-transparent px-[11px] py-[8px] text-left font-ui text-md text-accent-light hover:bg-accent-surface-2"
        data-hoverable
      >
        Name this session
      </button>
    )
  }

  return (
    <button
      type="button"
      aria-label="Rename session"
      onClick={open}
      className="-mx-[6px] cursor-text truncate rounded-chip border-0 bg-transparent px-[6px] py-[3px] text-left font-ui text-md font-medium text-ink hover:bg-accent-surface-2"
      data-hoverable
    >
      {session.name}
    </button>
  )
}
