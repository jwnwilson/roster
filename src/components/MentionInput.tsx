import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Agent, Status } from '@shared/types'
import { StatusDot } from './primitives'

interface MentionInputProps {
  value: string
  onChange: (value: string) => void
  /** Enter, when no agent list is open. */
  onSubmit: () => void
  agents: readonly Agent[]
  /** agentId -> the status its dot shows. */
  statuses: Record<string, Status>
  ariaLabel: string
  placeholder?: string
}

const LIST_ID = 'mention-suggestions'

/**
 * The mention being typed, if the caret sits inside one.
 *
 * Only the token immediately before the caret counts, so editing the middle
 * of a finished sentence does not reopen the list for a mention typed
 * earlier. The rules match `shared/mentions.ts`: an `@` that follows a word
 * character belongs to something else, such as an email address.
 *
 * Exported for its own tests — it is the whole of the interesting logic.
 */
export function activeMention(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const upto = text.slice(0, caret)
  const at = upto.lastIndexOf('@')
  if (at === -1) return null

  const before = at === 0 ? '' : (upto[at - 1] ?? '')
  if (before !== '' && /[\w@]/.test(before)) return null

  const query = upto.slice(at + 1)
  // Anything else — a space, punctuation — ended the token.
  if (!/^[a-zA-Z0-9-]*$/.test(query)) return null

  return { query: query.toLowerCase(), start: at }
}

/**
 * A comment box that completes `@agent-id`.
 *
 * Built on the ARIA combobox pattern, like `AssigneeField`, rather than
 * extracted from it: that one is a field holding a value, this is a popover
 * over free text driven by caret position, and one component doing both
 * would serve neither.
 */
export function MentionInput({
  value,
  onChange,
  onSubmit,
  agents,
  statuses,
  ariaLabel,
  placeholder,
}: MentionInputProps) {
  const ref = useRef<HTMLInputElement>(null)
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(0)
  const [pendingCaret, setPendingCaret] = useState<number | null>(null)

  // Moving the caret has to wait for the value React was handed to land.
  useEffect(() => {
    if (pendingCaret === null) return
    ref.current?.setSelectionRange(pendingCaret, pendingCaret)
    setCaret(pendingCaret)
    setPendingCaret(null)
  }, [pendingCaret])

  const token = dismissed ? null : activeMention(value, caret)
  const matches =
    token === null
      ? []
      : agents.filter(
          (agent) =>
            agent.id.includes(token.query) || agent.name.toLowerCase().includes(token.query),
        )
  const open = matches.length > 0
  const highlighted = matches[active] ?? matches[0]

  function pick(agent: Agent): void {
    if (token === null) return

    // The trailing space is what ends the token, so the list closes and the
    // next word is ordinary text.
    const next = `${value.slice(0, token.start)}@${agent.id} ${value.slice(caret)}`
    onChange(next)
    setDismissed(true)
    setActive(0)
    setPendingCaret(token.start + agent.id.length + 2)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    // The modal closes on Escape and posts on Enter elsewhere; while this
    // box has focus both keys belong to it.
    e.stopPropagation()

    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setActive((current) => (current + step + matches.length) % matches.length)
        return
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (highlighted) pick(highlighted)
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(true)
        return
      }
    }

    if (e.key === 'Enter') onSubmit()
  }

  return (
    <div className="relative flex-1">
      {open ? (
        <ul
          id={LIST_ID}
          role="listbox"
          aria-label="Agents"
          className="absolute right-0 bottom-full left-0 z-[5] m-0 mb-[3px] list-none overflow-hidden rounded-field border border-line-card bg-card p-0 shadow-[0_8px_20px_rgba(0,0,0,0.4)]"
        >
          {matches.map((agent, index) => (
            <li
              key={agent.id}
              id={`mention-${agent.id}`}
              role="option"
              aria-selected={index === active}
              // mousedown, not click: the input blurs first and the list
              // would go out from under the click.
              onMouseDown={(e) => {
                e.preventDefault()
                pick(agent)
              }}
              className={`flex cursor-pointer items-center gap-[7px] px-[9px] py-[6px] ${
                index === active ? 'bg-accent-surface-2' : ''
              }`}
              data-hoverable
            >
              <StatusDot status={statuses[agent.id] ?? 'idle'} />
              <span className="text-md text-ink">{agent.name}</span>
              <span className="ml-auto font-mono text-sm text-dim">@{agent.id}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <input
        ref={ref}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={LIST_ID}
        aria-autocomplete="list"
        {...(open && highlighted ? { 'aria-activedescendant': `mention-${highlighted.id}` } : {})}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setCaret(e.target.selectionStart ?? e.target.value.length)
          setDismissed(false)
          setActive(0)
        }}
        onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
        className="w-full rounded-chip border border-line-card bg-card px-[10px] py-[6px] font-ui text-md text-ink outline-none placeholder:text-faint focus:border-accent-line focus:bg-accent-surface-2"
      />
    </div>
  )
}
