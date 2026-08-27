import { useState, type KeyboardEvent } from 'react'

interface LabelChipsProps {
  labels: readonly string[]
  onAdd: (label: string) => void
  onRemove: (label: string) => void
}

/**
 * The label row: removable chips plus a dashed "+ Add" that opens an inline
 * input. Enter confirms, Escape and blur cancel — the same inline-edit
 * grammar the skills tree uses, so the two do not have to be learned twice.
 */
export function LabelChips({ labels, onAdd, onRemove }: LabelChipsProps) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')

  function confirm(): void {
    const value = text.trim()
    if (value !== '') onAdd(value)
    setText('')
    setAdding(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      confirm()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      // Escape belongs to the label being typed. Letting it reach the modal
      // would close the whole dialog over an abandoned chip.
      e.stopPropagation()
      setText('')
      setAdding(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-[6px]">
      {labels.map((label) => (
        <span
          key={label}
          className="flex items-center gap-[6px] rounded-[10px] bg-[#1a1c23] px-[8px] py-[3px] text-2xs text-muted-2"
        >
          {label}
          <button
            type="button"
            aria-label={`Remove label ${label}`}
            onClick={() => onRemove(label)}
            className="cursor-pointer border-0 bg-transparent p-0 font-ui text-2xs leading-none text-dim hover:text-error"
            data-hoverable
          >
            −
          </button>
        </span>
      ))}

      {adding ? (
        <input
          type="text"
          autoFocus
          aria-label="New label"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setText('')
            setAdding(false)
          }}
          className="w-[110px] rounded-[10px] border border-accent-line bg-accent-surface-2 px-[8px] py-[3px] font-ui text-2xs text-ink outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="cursor-pointer rounded-[10px] border border-dashed border-line-dashed bg-transparent px-[8px] py-[3px] font-ui text-2xs text-dim hover:border-line-hover-strong hover:text-ink-3"
          data-hoverable
        >
          + Add
        </button>
      )}
    </div>
  )
}
