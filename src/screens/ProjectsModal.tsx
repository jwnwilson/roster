import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import type { Project } from '@shared/types'
import { PROJECT_COLORS } from '@shared/tasks'
import { Modal, Segmented, TextInput } from '@/components/primitives'
import { messageFor } from '@/lib/errors'
import { relativeTime } from '@/state/format'
import { ALL_PROJECTS, activeProjects, archivedProjects, useRoster } from '@/state/store'

interface Draft {
  name: string
  color: string
  description: string
}

const BLANK: Draft = { name: '', color: PROJECT_COLORS[0] as string, description: '' }

/**
 * Rows per page. Chosen so a full page still fits inside the card's floor
 * without scrolling: past this the list is long enough that paging through it
 * beats a scrollbar you have to drag past the projects you have finished with.
 */
const PAGE_SIZE = 5

/** How tall and wide the card sits, whatever the list is doing inside it. */
const MODAL_WIDTH = 640
const MODAL_MIN_HEIGHT = 520

/**
 * Active and Archived, as two views of one list.
 *
 * Archiving is the everyday way to finish with a project: it keeps the row,
 * its tasks and its sessions, and only stops the app offering it. Delete
 * lives on the Archived tab alone, so destroying a grouping always takes two
 * deliberate steps.
 */
type ProjectsTab = 'active' | 'archived'

const TABS: readonly { value: ProjectsTab; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
]

export function ProjectsModal() {
  const active = useRoster(useShallow(activeProjects))
  const archived = useRoster(useShallow(archivedProjects))
  const tasks = useRoster(useShallow((s) => s.tasks))
  const close = () => useRoster.getState().setProjectsOpen(false)

  const [tab, setTab] = useState<ProjectsTab>('active')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [error, setError] = useState<string | null>(null)

  const showing = tab === 'active' ? active : archived
  const matching = useMemo(() => matchingProjects(showing, query), [showing, query])

  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE))
  // Archiving or deleting the last row on the last page would otherwise leave
  // you staring at an empty one with no way to tell what happened.
  const current = Math.min(page, pageCount - 1)
  const visible = matching.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE)

  const filtering = query.trim() !== ''
  const summary = filtering
    ? `${matching.length} of ${showing.length} match`
    : `${showing.length} ${showing.length === 1 ? 'project' : 'projects'}`

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

  async function setArchived(project: Project, archive: boolean): Promise<void> {
    setError(null)
    try {
      await window.roster.projects.setArchived(project.id, archive)
      await reload()
      // The filter only offers active projects, so one pointing at a project
      // just put away would show an empty board with no way to tell why.
      if (archive) clearFilterOn(project.id)
    } catch (cause) {
      setError(messageFor(cause))
    }
  }

  async function remove(project: Project): Promise<void> {
    setError(null)
    try {
      // The confirmation lives in the main process; false means it was
      // dismissed, and nothing here should move.
      const deleted = await window.roster.projects.remove(project.id)
      if (!deleted) return

      // Tasks keep existing, so re-read them too — they have just lost
      // their project, and the board must stop claiming otherwise.
      useRoster.setState((s) => ({
        tasks: s.tasks.map((task) =>
          task.projectId === project.id ? { ...task, projectId: null } : task,
        ),
      }))
      clearFilterOn(project.id)
      await reload()
    } catch (cause) {
      setError(messageFor(cause))
    }
  }

  function beginEdit(project: Project): void {
    setDraft({
      name: project.name,
      color: project.color,
      description: project.description,
    })
    setEditing(project.id)
  }

  function changeQuery(next: string): void {
    setQuery(next)
    // The row being edited may not survive the new filter, and a page number
    // from the old list means nothing against the new one.
    setPage(0)
    setEditing(null)
  }

  return (
    <Modal
      label="Projects"
      onClose={close}
      maxWidth={MODAL_WIDTH}
      minHeight={MODAL_MIN_HEIGHT}
      header={
        <div className="flex items-center gap-[12px]">
          <h2 className="m-0 text-2xl font-semibold">Projects</h2>
          <Segmented
            ariaLabel="Projects view"
            options={TABS}
            value={tab}
            onChange={(next) => {
              setTab(next)
              setPage(0)
              // A form left open on the other tab would reopen against a
              // project this one does not show.
              setEditing(null)
              setCreating(false)
            }}
          />
        </div>
      }
      footer={
        pageCount > 1 ? (
          <>
            <span className="text-md text-dim">
              Page {current + 1} of {pageCount}
            </span>
            <div className="ml-auto flex gap-[8px]">
              <SecondaryButton
                label="Previous"
                onClick={() => setPage(current - 1)}
                disabled={current === 0}
              />
              <SecondaryButton
                label="Next"
                onClick={() => setPage(current + 1)}
                disabled={current === pageCount - 1}
              />
            </div>
          </>
        ) : undefined
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-none items-center gap-[10px] border-b border-line px-[18px] py-[10px]">
          <TextInput
            ariaLabel="Filter projects"
            placeholder="Filter projects"
            value={query}
            onChange={changeQuery}
            className="w-[220px]"
          />
          <span className="text-md text-dim">{summary}</span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto px-[18px] py-[14px]">
          {visible.map((project) => (
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
                <ProjectRow
                  project={project}
                  taskCount={tasks.filter((task) => task.projectId === project.id).length}
                  onEdit={() => beginEdit(project)}
                  onArchive={() => void setArchived(project, true)}
                  onRestore={() => void setArchived(project, false)}
                  onDelete={() => void remove(project)}
                />
              )}
            </div>
          ))}

          {matching.length === 0 ? (
            <p className="m-0 text-md text-dim">
              {emptyMessage(tab, filtering, archived.length)}
            </p>
          ) : null}

          {tab === 'archived' ? null : creating ? (
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
      </div>
    </Modal>
  )
}

/** Name or description, case-insensitively — the two things a row shows. */
function matchingProjects(projects: readonly Project[], query: string): readonly Project[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return projects

  return projects.filter(
    (project) =>
      project.name.toLowerCase().includes(needle) ||
      project.description.toLowerCase().includes(needle),
  )
}

/** Nothing to show, said in the way that fits why. */
function emptyMessage(tab: ProjectsTab, filtering: boolean, archivedCount: number): string {
  // A filter that matched nothing is not an empty list, and saying so would
  // send someone looking for projects that are right there.
  if (filtering) return 'No projects match.'
  if (tab === 'archived') return 'No archived projects.'
  // "No projects yet" would be a lie when they are all simply put away.
  return archivedCount > 0 ? 'No active projects.' : 'No projects yet.'
}

/** A filter pointing at a project the dropdown no longer offers has to let go. */
function clearFilterOn(projectId: string): void {
  const { projectFilter, setProjectFilter } = useRoster.getState()
  if (projectFilter === projectId) setProjectFilter(ALL_PROJECTS)
}

interface ProjectRowProps {
  project: Project
  taskCount: number
  onEdit: () => void
  onArchive: () => void
  onRestore: () => void
  onDelete: () => void
}

function ProjectRow({
  project,
  taskCount,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: ProjectRowProps) {
  const isArchived = project.archivedAt !== null

  return (
    <>
      <div className="flex items-center gap-[9px]">
        <span
          aria-hidden
          className="flex-none rounded-full"
          style={{
            width: 8,
            height: 8,
            background: project.color,
            // Dimmed rather than recoloured, so an archived project is still
            // recognisably the one you filed the work under.
            opacity: isArchived ? 0.5 : 1,
          }}
        />
        <span className={`text-xl font-semibold ${isArchived ? 'text-muted-2' : ''}`}>
          {project.name}
        </span>
        <span className="font-mono text-xs text-dim-2">{taskCount} tasks</span>

        {isArchived ? (
          <>
            <span className="text-sm text-dim-2">
              Archived {relativeTime(project.archivedAt as number)}
            </span>
            <SecondaryButton label="Restore" onClick={onRestore} className="ml-auto" />
            <SecondaryButton label="Delete" onClick={onDelete} destructive />
          </>
        ) : (
          <>
            <SecondaryButton label="Edit" onClick={onEdit} className="ml-auto" />
            {/* Not destructive: nothing is lost, and it can be taken back. */}
            <SecondaryButton label="Archive" onClick={onArchive} />
          </>
        )}
      </div>
      {project.description === '' ? null : (
        <p className="m-0 text-md leading-[1.5] text-muted-2">{project.description}</p>
      )}
    </>
  )
}

interface SecondaryButtonProps {
  label: string
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
  className?: string
}

function SecondaryButton({
  label,
  onClick,
  destructive = false,
  disabled = false,
  className = '',
}: SecondaryButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`cursor-pointer rounded-sm border border-line-input bg-transparent px-[9px] py-[3px] font-ui text-sm disabled:cursor-default disabled:opacity-40 ${
        destructive ? 'text-error hover:border-error' : 'text-ink-3 hover:border-line-hover-strong'
      } ${className}`}
      data-hoverable
    >
      {label}
    </button>
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
