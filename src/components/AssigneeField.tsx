import { useRef, useState, type KeyboardEvent } from 'react'
import type { Agent, Status } from '@shared/types'
import { statusColor } from '@shared/status'

interface AssigneeFieldProps {
  agents: readonly Agent[]
  /** The assigned agent's id, or null. */
  value: string | null
  onChange: (agentId: string | null) => void
  /** agentId -> the status its dot shows. */
  statuses: Record<string, Status>
}

interface Suggestion {
  id: string | null
  name: string
  status: Status | null
}

const UNASSIGNED_LABEL = 'Unassigned'

/**
 * Type-to-filter assignee picker, per the handoff § Tasks.
 *
 * A combobox rather than a `<select>` because a roster is open-ended — the
 * design filters by name for the same reason the sidebar and the board do.
 * Built on the ARIA combobox pattern so the keyboard still works: arrows
 * move through the list, Enter picks, Escape closes without changing
 * anything.
 */
export function AssigneeField({ agents, value, onChange, statuses }: AssigneeFieldProps) {
  const assigned = agents.find((agent) => agent.id === value) ?? null

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const options: Suggestion[] = [
    { id: null, name: UNASSIGNED_LABEL, status: null },
    ...agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: statuses[agent.id] ?? 'idle',
    })),
  ]

  const matches = options.filter((option) =>
    option.name.toLowerCase().includes(query.trim().toLowerCase()),
  )

  // Closed, the field shows who is assigned; open, it shows what you typed.
  const shown = open ? query : (assigned?.name ?? '')

  function openList(): void {
    // Opens empty rather than pre-filled with the assignee's name: that name
    // would filter the list down to itself, putting "Unassigned" — and every
    // other agent — out of reach of the control that is supposed to offer
    // them. The name is still shown whenever the field is closed.
    setQuery('')
    setActive(0)
    setOpen(true)
  }

  function close(): void {
    setOpen(false)
    setQuery('')
  }

  function pick(option: Suggestion): void {
    onChange(option.id)
    close()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    // The modal closes on Escape; while this list is open the key belongs
    // to the list.
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        openList()
        return
      }
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((current) => {
        if (matches.length === 0) return 0
        return (current + step + matches.length) % matches.length
      })
      return
    }

    if (e.key === 'Enter' && open) {
      e.preventDefault()
      const option = matches[active]
      if (option) pick(option)
    }
  }

  return (
    <div className="relative">
      <input
        type="text"
        role="combobox"
        aria-label="Assignee"
        aria-expanded={open}
        aria-controls="assignee-suggestions"
        aria-autocomplete="list"
        placeholder={UNASSIGNED_LABEL}
        value={shown}
        onFocus={openList}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Let a click on a suggestion land before the list disappears.
          blurTimer.current = setTimeout(close, 120)
        }}
        className="w-full rounded-chip border border-line-input bg-card py-[5px] pr-[24px] pl-[8px] font-ui text-md text-ink outline-none placeholder:text-faint focus:border-accent-line focus:bg-accent-surface-2"
      />

      {assigned && !open ? (
        <button
          type="button"
          aria-label="Clear assignee"
          onClick={() => onChange(null)}
          className="absolute top-1/2 right-[6px] flex h-[14px] w-[14px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 font-ui text-md leading-none text-dim hover:bg-accent-surface-3 hover:text-ink"
          data-hoverable
        >
          ×
        </button>
      ) : null}

      {open ? (
        <ul
          id="assignee-suggestions"
          role="listbox"
          aria-label="Assignee suggestions"
          className="absolute top-full right-0 left-0 z-[5] m-0 mt-[3px] list-none overflow-hidden rounded-pill border border-line-card bg-card p-0 shadow-[0_8px_20px_rgba(0,0,0,0.4)]"
        >
          {matches.length === 0 ? (
            <li className="px-[9px] py-[6px] text-md text-dim">No agent matches.</li>
          ) : (
            matches.map((option, index) => (
              <li
                key={option.id ?? 'none'}
                role="option"
                aria-selected={index === active}
                // mousedown, not click: blur fires first and would close the
                // list out from under the click.
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (blurTimer.current) clearTimeout(blurTimer.current)
                  pick(option)
                }}
                onMouseEnter={() => setActive(index)}
                className={`flex cursor-pointer items-center gap-[7px] px-[9px] py-[6px] text-md text-ink-3 ${
                  index === active ? 'bg-[#1c1e26]' : ''
                }`}
              >
                {option.status === null ? (
                  <span
                    aria-hidden
                    className="flex-none rounded-full"
                    style={{ width: 6, height: 6, background: 'var(--color-off)' }}
                  />
                ) : (
                  <span
                    aria-hidden
                    className="flex-none rounded-full"
                    style={{ width: 6, height: 6, background: statusColor(option.status) }}
                  />
                )}
                {option.name}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
