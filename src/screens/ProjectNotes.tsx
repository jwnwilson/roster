import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '@shared/types'
import { FileEditor } from '@/components/FileEditor'
import { messageFor } from '@/lib/errors'

interface ProjectNotesProps {
  project: Project
  onBack: () => void
}

/**
 * A project's NOTES.md, open for editing.
 *
 * What the project knows that is not a task — decisions, conventions,
 * gotchas — and the same text every agent filed under it is sent at the top
 * of its turn. Worth saying plainly, since a note here goes to the model as
 * surely as a task does.
 *
 * Saving writes the whole file, because this is the user's copy of it.
 * Agents only ever append, so nothing they wrote can be lost by an edit they
 * did not make — only by one the user makes deliberately.
 */
export function ProjectNotes({ project, onBack }: ProjectNotesProps) {
  const [contents, setContents] = useState('')
  const [saved, setSaved] = useState('')
  const [error, setError] = useState<string | null>(null)

  /**
   * What is on disk, readable from inside the change listener. State alone
   * would close over the value it had when the listener was registered.
   */
  const savedRef = useRef('')

  const adopt = useCallback((text: string): void => {
    savedRef.current = text
    setSaved(text)
  }, [])

  useEffect(() => {
    let cancelled = false

    void window.roster.projects
      .readNotes(project.id)
      .then((text) => {
        if (cancelled) return
        adopt(text)
        setContents(text)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageFor(cause))
      })

    return () => {
      cancelled = true
    }
  }, [project.id, adopt])

  // An agent appending mid-turn, or an edit made in another editor.
  useEffect(() => {
    return window.roster.projects.onNotesChanged(({ projectId, notes }) => {
      if (projectId !== project.id) return

      const previous = savedRef.current
      adopt(notes)
      // Only when there is nothing to lose. Someone typing here is the other
      // writer, and their draft is not ours to throw away.
      setContents((current) => (current === previous ? notes : current))
    })
  }, [project.id, adopt])

  async function save(): Promise<void> {
    try {
      await window.roster.projects.writeNotes(project.id, contents)
      adopt(contents)
      setError(null)
    } catch (cause) {
      setError(messageFor(cause))
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FileEditor
        label={`${project.name} / NOTES.md`}
        value={contents}
        saved={saved}
        onChange={setContents}
        onRevert={() => setContents(saved)}
        onSave={() => void save()}
        error={error}
        ariaLabel="Project notes"
      >
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer rounded-chip border border-line-input bg-transparent px-[10px] py-[4px] font-ui text-base text-muted hover:border-line-hover"
          data-hoverable
        >
          Back to projects
        </button>
      </FileEditor>

      <p className="m-0 flex-none border-t border-line px-[16px] py-[8px] text-sm text-dim">
        Every agent working on this project is sent these notes at the start of each
        turn. Agents with the <span className="font-mono">memory</span> server append to
        them; they never rewrite them.
      </p>
    </div>
  )
}
