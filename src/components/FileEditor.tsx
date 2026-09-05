import type { ReactNode } from 'react'
import { CodeEditor } from '@/components/CodeEditor'

interface FileEditorProps {
  /** What is open, shown in the strip above the editor. */
  label: string
  value: string
  /** What is on disk, so the strip can say whether there is anything to save. */
  saved: string
  onChange: (value: string) => void
  onRevert: () => void
  onSave: () => void
  /** Shown in place of the editor: there is nothing to edit if it cannot be read. */
  error?: string | null
  /** How the text box names itself to a screen reader. */
  ariaLabel: string
  /** Controls that belong in the strip, before Revert and Save. */
  children?: ReactNode
}

/**
 * One Markdown file, open for editing: a strip saying what is open and
 * whether it is saved, then the editor itself.
 *
 * Lifted out of the Skills screen so a project's NOTES.md is edited by the
 * same thing rather than by a second editor that would drift from it. The
 * state stays with the caller — each file is loaded and written by whoever
 * knows how to reach it.
 */
export function FileEditor({
  label,
  value,
  saved,
  onChange,
  onRevert,
  onSave,
  error = null,
  ariaLabel,
  children,
}: FileEditorProps) {
  const dirty = value !== saved

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-sunken">
      <div className="flex flex-none items-center gap-[10px] border-b border-line px-[16px] py-[8px]">
        <span className="truncate font-mono text-md text-ink-3">{label}</span>
        {dirty ? (
          <>
            <span aria-hidden className="h-[5px] w-[5px] flex-none rounded-full bg-amber" />
            <span className="flex-none text-sm text-dim">unsaved</span>
          </>
        ) : null}
        <div className="ml-auto flex flex-none gap-[7px]">
          {children}
          <button
            type="button"
            onClick={onRevert}
            disabled={!dirty}
            className="cursor-pointer rounded-chip border border-line-input bg-transparent px-[10px] py-[4px] font-ui text-base text-muted hover:border-line-hover disabled:cursor-default disabled:opacity-40"
            data-hoverable
          >
            Revert
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty}
            className="cursor-pointer rounded-chip border-0 bg-accent-surface-3 px-[10px] py-[4px] font-ui text-base font-semibold text-accent-text disabled:cursor-default disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>

      {error ? (
        <p className="m-0 px-[20px] py-[14px] text-md text-error">{error}</p>
      ) : (
        <CodeEditor value={value} onChange={onChange} ariaLabel={ariaLabel} />
      )}
    </div>
  )
}
