import { useState } from 'react'
import { useShallow } from 'zustand/shallow'
import type { Project } from '@shared/types'
import { PROJECT_COLORS } from '@shared/tasks'
import { Modal, TextInput } from '@/components/primitives'
import { messageFor } from '@/lib/errors'
import { ALL_PROJECTS, useRoster } from '@/state/store'

interface Draft {
  name: string
  color: string
  description: string
}

const BLANK: Draft = { name: '', color: PROJECT_COLORS[0] as string, description: '' }

export function ProjectsModal() {
  const projects = useRoster(useShallow((s) => s.projects))
  const tasks = useRoster(useShallow((s) => s.tasks))
  const close = () => useRoster.getState().setProjectsOpen(false)

  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [error, setError] = useState<string | null>(null)

  async function reload(): Promise<void> {
    useRoster.setState({ projects: await window.roster.projects.list() })
  }

  async function save(id: string): Promise<void> {
    setError(null)
    try {
      await window.roster.projects.update(id, draft)
      await reload()
      setEditing(null)
    } catch (cause) {
      setError(messageFor(cause))
    }
  }

  async function create(): Promise<void> {
    setError(null)
    try {
      await window.roster.projects.create(draft)
      await reload()
      setCreating(false)
      setDraft(BLANK)
    } catch (cause) {
      setError(messageFor(cause))
    }
  }

  async function remove(project: Project): Promise<void> {
    setError(null)
    try {
      await window.roster.projects.remove(project.id)
      // Tasks keep existing, so re-read them too — they have just lost
      // their project, and the board must stop claiming otherwise.
      useRoster.setState((s) => ({
        tasks: s.tasks.map((task) =>
          task.projectId === project.id ? { ...task, projectId: null } : task,
        ),
        // A filter pointing at a project that no longer exists would show an
        // empty board with no way to tell why.
        ...(s.projectFilter === project.id ? { projectFilter: ALL_PROJECTS } : {}),
      }))
      await reload()
    } catch (cause) {
      setError(messageFor(cause))
    }
  }

  return (
    <Modal
      label="Projects"
      onClose={close}
      header={<h2 className="m-0 text-2xl font-semibold">Projects</h2>}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto px-[18px] py-[14px]">
        {projects.map((project) => (
          <div
            key={project.id}
            className="flex flex-col gap-[9px] rounded-[9px] border border-line px-[13px] py-[11px]"
          >
            {editing === project.id ? (
              <Editor
                draft={draft}
                setDraft={setDraft}
                onCancel={() => setEditing(null)}
                onSave={() => void save(project.id)}
                saveLabel="Save"
              />
            ) : (
              <>
                <div className="flex items-center gap-[9px]">
                  <span
                    aria-hidden
                    className="flex-none rounded-full"
                    style={{ width: 8, height: 8, background: project.color }}
                  />
                  <span className="text-xl font-semibold">{project.name}</span>
                  <span className="font-mono text-xs text-dim-2">
                    {tasks.filter((task) => task.projectId === project.id).length} tasks
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft({
                        name: project.name,
                        color: project.color,
                        description: project.description,
                      })
                      setEditing(project.id)
                    }}
                    className="ml-auto cursor-pointer rounded-sm border border-line-input bg-transparent px-[9px] py-[3px] font-ui text-sm text-ink-3 hover:border-line-hover-strong"
                    data-hoverable
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(project)}
                    className="cursor-pointer rounded-sm border border-line-input bg-transparent px-[9px] py-[3px] font-ui text-sm text-error hover:border-error"
                    data-hoverable
                  >
                    Delete
                  </button>
                </div>
                {project.description === '' ? null : (
                  <p className="m-0 text-md leading-[1.5] text-muted-2">{project.description}</p>
                )}
              </>
            )}
          </div>
        ))}

        {creating ? (
          <div className="flex flex-col gap-[9px] rounded-[9px] border border-line-card px-[13px] py-[12px]">
            <Editor
              draft={draft}
              setDraft={setDraft}
              onCancel={() => {
                setCreating(false)
                setDraft(BLANK)
              }}
              onSave={() => void create()}
              saveLabel="Create"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(BLANK)
              setCreating(true)
            }}
            className="cursor-pointer rounded-[9px] border border-dashed border-line-dashed bg-transparent p-[9px] font-ui text-lg text-dim hover:border-line-hover-strong hover:text-ink"
            data-hoverable
          >
            + New project
          </button>
        )}

        {error ? <p className="m-0 text-md text-error">{error}</p> : null}
      </div>
    </Modal>
  )
}

interface EditorProps {
  draft: Draft
  setDraft: (draft: Draft) => void
  onCancel: () => void
  onSave: () => void
  saveLabel: string
}

function Editor({ draft, setDraft, onCancel, onSave, saveLabel }: EditorProps) {
  return (
    <>
      <TextInput
        ariaLabel="Project name"
        placeholder="Project name"
        value={draft.name}
        onChange={(name) => setDraft({ ...draft, name })}
        className="w-full"
      />
      <textarea
        aria-label="Project description"
        placeholder="Description"
        value={draft.description}
        rows={2}
        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        className="w-full resize-y rounded-pill border border-line-card bg-card px-[10px] py-[8px] font-ui text-md leading-[1.5] text-ink-2 outline-none focus:border-accent-line focus:bg-accent-surface-2"
      />

      <div className="flex gap-[6px]">
        {PROJECT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Colour ${color}`}
            aria-pressed={draft.color === color}
            onClick={() => setDraft({ ...draft, color })}
            className="cursor-pointer rounded-full p-0 hover:border-line-hover-strong"
            style={{
              width: 18,
              height: 18,
              background: color,
              // The chosen swatch keeps a ring, so the selection survives
              // being the same colour as the ring would have been.
              border: `2px solid ${draft.color === color ? 'var(--color-ink)' : 'transparent'}`,
            }}
            data-hoverable
          />
        ))}
      </div>

      <div className="flex justify-end gap-[8px]">
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded-chip border border-line-card bg-transparent px-[11px] py-[5px] font-ui text-base text-ink-3 hover:border-line-hover-strong"
          data-hoverable
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={draft.name.trim() === ''}
          className="cursor-pointer rounded-chip border-0 bg-accent px-[12px] py-[5px] font-ui text-base font-semibold text-white hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
        >
          {saveLabel}
        </button>
      </div>
    </>
  )
}
