import { useEffect, useState } from 'react'
import type { Project, ProjectRepo } from '@shared/types'
import { useRoster } from '@/state/store'
import { messageFor } from '@/lib/errors'

interface ProjectReposProps {
  project: Project
  onBack: () => void
}

/**
 * The checkouts a project's work happens in.
 *
 * Its own sub-view rather than a section of the edit form, for a concrete
 * reason: the form stages every change in a draft and commits it on Save, and
 * a project being *created* has no id yet to hang a repository on. These
 * write through immediately, against a project that already exists.
 *
 * The first row is the primary — the one a turn runs in. The rest are
 * reachable, not where the agent is standing.
 */
export function ProjectRepos({ project, onBack }: ProjectReposProps) {
  const repos = useRoster((s) => s.projectRepos[project.id])
  const setProjectRepos = useRoster((s) => s.setProjectRepos)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    void window.roster.projects.repos
      .list(project.id)
      .then((list) => {
        if (!cancelled) setProjectRepos(project.id, list)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageFor(cause))
      })

    return () => {
      cancelled = true
    }
  }, [project.id, setProjectRepos])

  /**
   * Every mutation goes through here because they all answer with the whole
   * list: remove and reorder renumber the rows around the one they touched,
   * so patching a single row in place would leave stale positions behind.
   */
  async function apply(change: () => Promise<ProjectRepo[]>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      setProjectRepos(project.id, await change())
    } catch (cause: unknown) {
      setError(messageFor(cause))
    } finally {
      setBusy(false)
    }
  }

  async function add(): Promise<void> {
    const path = await window.roster.dialog.chooseDirectory()
    // Cancelling the picker is not a change.
    if (path === null) return

    await apply(() => window.roster.projects.repos.add({ projectId: project.id, path }))
  }

  const list = repos ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-[10px] border-b border-line px-[18px] py-[10px]">
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer rounded-chip border border-line bg-transparent px-[9px] py-[4px] font-ui text-md text-muted hover:border-line-hover-strong hover:text-ink"
        >
          Back
        </button>
        <span className="text-xl font-semibold">{project.name}</span>
        <span className="text-md text-dim">
          {list.length === 0
            ? 'No repositories yet'
            : `${list.length} ${list.length === 1 ? 'repository' : 'repositories'}`}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto px-[18px] py-[14px]">
        <p className="m-0 text-md leading-[1.5] text-muted-2">
          Sessions filed under this project run in the primary repository. The rest are
          listed in the project brief so agents know what they are, and can be read
          from the same session.
        </p>

        {list.map((repo, index) => (
          <RepoRow
            key={repo.id}
            repo={repo}
            isPrimary={index === 0}
            canMoveUp={index > 0 && !busy}
            canMoveDown={index < list.length - 1 && !busy}
            onMakePrimary={() =>
              void apply(() =>
                window.roster.projects.repos.reorder(project.id, [
                  repo.id,
                  ...list.filter((other) => other.id !== repo.id).map((other) => other.id),
                ]),
              )
            }
            onMove={(delta) =>
              void apply(() =>
                window.roster.projects.repos.reorder(project.id, moved(list, index, delta)),
              )
            }
            onDescribe={(description) =>
              void apply(() => window.roster.projects.repos.update(repo.id, { description }))
            }
            onRemove={() => void apply(() => window.roster.projects.repos.remove(repo.id))}
          />
        ))}

        <button
          type="button"
          disabled={busy}
          onClick={() => void add()}
          className="cursor-pointer rounded-[9px] border border-dashed border-line-dashed bg-transparent p-[9px] font-ui text-lg text-dim hover:border-line-hover-strong hover:text-ink"
          data-hoverable
        >
          + Add repository
        </button>

        {error ? <p className="m-0 text-md text-error">{error}</p> : null}
      </div>
    </div>
  )
}

/** The list's ids with one row shifted by `delta`. */
function moved(list: readonly ProjectRepo[], index: number, delta: number): string[] {
  const ids = list.map((repo) => repo.id)
  const target = index + delta
  const [lifted] = ids.splice(index, 1)
  if (lifted !== undefined) ids.splice(target, 0, lifted)
  return ids
}

interface RepoRowProps {
  repo: ProjectRepo
  isPrimary: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMakePrimary: () => void
  onMove: (delta: number) => void
  onDescribe: (description: string) => void
  onRemove: () => void
}

function RepoRow({
  repo,
  isPrimary,
  canMoveUp,
  canMoveDown,
  onMakePrimary,
  onMove,
  onDescribe,
  onRemove,
}: RepoRowProps) {
  const [description, setDescription] = useState(repo.description)

  return (
    <div className="flex flex-col gap-[7px] rounded-[9px] border border-line px-[13px] py-[11px]">
      <div className="flex items-center gap-[9px]">
        <span className="text-xl font-semibold">{repo.name}</span>

        {isPrimary ? (
          <span className="rounded-chip bg-accent-surface-2 px-[7px] py-[2px] text-xs font-semibold text-accent">
            Primary
          </span>
        ) : null}

        {/* Shown and marked rather than hidden: dropping a repository whose
            directory has moved would read as "this project has one repo",
            which is a different and wrong claim. */}
        {!repo.exists ? (
          <span className="text-sm text-error" title={repo.path}>
            directory not found
          </span>
        ) : !repo.isRepository ? (
          <span className="text-sm text-amber" title={repo.path}>
            not a git checkout
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-[6px]">
          {isPrimary ? null : (
            <RowButton label="Make primary" onClick={onMakePrimary} />
          )}
          <RowButton label="Move up" onClick={() => onMove(-1)} disabled={!canMoveUp} />
          <RowButton label="Move down" onClick={() => onMove(1)} disabled={!canMoveDown} />
          <RowButton label="Remove" onClick={onRemove} destructive />
        </div>
      </div>

      <span className="font-mono text-sm text-dim-2">{repo.pathLabel}</span>

      <input
        type="text"
        value={description}
        aria-label={`What ${repo.name} is`}
        placeholder="What this repository is — one line, for the agent"
        onChange={(e) => setDescription(e.target.value)}
        // Committed on blur rather than per keystroke: every save re-reads and
        // broadcasts the whole list, which is far too much for a text field.
        onBlur={() => {
          if (description !== repo.description) onDescribe(description)
        }}
        className="w-full rounded-chip border border-line bg-card px-[9px] py-[5px] font-ui text-md text-ink outline-none placeholder:text-faint focus:border-accent-line focus:bg-accent-surface-2"
      />
    </div>
  )
}

function RowButton({
  label,
  onClick,
  disabled = false,
  destructive = false,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`rounded-chip border border-line bg-transparent px-[8px] py-[3px] font-ui text-sm ${
        disabled
          ? 'cursor-default text-faint-2'
          : `cursor-pointer hover:border-line-hover-strong ${
              destructive ? 'text-error hover:text-error' : 'text-muted hover:text-ink'
            }`
      }`}
    >
      {label}
    </button>
  )
}
