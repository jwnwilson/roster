import { Fragment, useEffect, useMemo, useState } from 'react'
import type { Skill } from '@shared/types'
import { statusColor } from '@shared/status'
import {
  GhostButton,
  IconButton,
  PrimaryButton,
  ScreenHeader,
  SectionLabel,
} from '@/components/primitives'
import { TrashIcon } from '@/components/icons'
import { useRoster } from '@/state/store'
import { messageFor } from '@/lib/errors'
import { relativeTime } from '@/state/format'
import { CodeEditor } from '@/components/CodeEditor'

/** A row in the file tree: a skill folder or one of its files. */
interface TreeRow {
  key: string
  name: string
  depth: number
  isDir: boolean
  skill: Skill
  /** Absolute path, for files only. */
  path?: string
}

/** Row indentation, in px: where depth 0 starts, and what each level adds. */
const TREE_GUTTER_PX = 12
const INDENT_PX = 14
/** The disclosure column, which every row reserves so the names line up. */
const DISCLOSURE_PX = 13

export function Skills() {
  const skills = useRoster((s) => s.skills)
  const agents = useRoster((s) => s.agents)

  const [openPath, setOpenPath] = useState<string | null>(null)
  const [contents, setContents] = useState('')
  const [saved, setSaved] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** What is being created and inside which row, if anything. */
  const [creating, setCreating] = useState<{ kind: 'file' | 'folder'; parent: TreeRow } | null>(
    null,
  )
  /** Which tree row is selected. Files also open; folders and skills only select. */
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  /**
   * Folders the user has folded away, by row key.
   *
   * Collapsed rather than expanded, so everything starts open: the tree looks
   * the way it always has until somebody asks for it not to, and no file is
   * hidden by a default nobody chose.
   */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const setSkills = useRoster((st) => st.setSkills)

  const rows = useMemo(() => buildTree(skills), [skills])
  const visibleRows = useMemo(
    () => rows.filter((row) => !isHidden(row.key, collapsed)),
    [rows, collapsed],
  )

  // Open the first SKILL.md so the editor is never empty on arrival.
  useEffect(() => {
    if (openPath !== null) return
    const first = rows.find((r) => !r.isDir && r.name === 'SKILL.md')
    if (first?.path) {
      setOpenPath(first.path)
      setSelectedKey(first.key)
    }
  }, [rows, openPath])

  // Whatever the editor is showing must be reachable in the tree, so opening a
  // file reopens the folders above it. This runs on open, not on every render,
  // so a folder collapsed afterwards stays collapsed.
  useEffect(() => {
    if (openPath === null) return
    const row = rows.find((r) => r.path === openPath)
    if (row === undefined) return

    setCollapsed((current) => withRevealed(current, row.key))
  }, [openPath, rows])

  useEffect(() => {
    if (openPath === null) return
    let cancelled = false

    void window.roster.skills
      .read(openPath)
      .then((text) => {
        if (cancelled) return
        setContents(text)
        setSaved(text)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageFor(cause))
      })

    return () => {
      cancelled = true
    }
  }, [openPath])

  const dirty = contents !== saved
  const openRow = rows.find((r) => r.path === openPath) ?? null
  const selected = rows.find((r) => r.key === selectedKey) ?? null

  async function reveal(): Promise<void> {
    // Reveals the open skill's folder, or the library itself when none is open.
    const name = openRow?.skill.name ?? skills[0]?.name
    if (name === undefined) return
    await window.roster.skills.reveal(name)
  }

  async function createSkill(): Promise<void> {
    setBusy(true)
    setError(null)

    try {
      const created = await window.roster.skills.create('New skill')
      setSkills(await window.roster.skills.list())
      // Open it straight away, so the button leaves you somewhere useful.
      setOpenPath(`${created.path}/SKILL.md`)
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Adds a skill the user already has somewhere else.
   *
   * The folder is linked rather than copied, so it stays the file they were
   * already editing — a copy would go stale the moment either side moved.
   */
  async function addSkill(): Promise<void> {
    const chosen = await window.roster.dialog.chooseDirectory()
    if (chosen === null) return

    setBusy(true)
    setError(null)

    try {
      const linked = await window.roster.skills.link(chosen)
      setSkills(await window.roster.skills.list())
      setOpenPath(`${linked.path}/SKILL.md`)
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      setBusy(false)
    }
  }

  function toggleFolder(key: string): void {
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  /**
   * Creates inside the row whose icon was clicked, so the target is whatever
   * the user pointed at rather than whichever file happens to be open.
   */
  async function createEntry(name: string): Promise<void> {
    if (creating === null) return

    const { kind, parent } = creating
    const skill = parent.skill.name
    // A skill row creates at its root; a folder row creates inside it.
    const prefix = parent.depth === 0 ? '' : `${relativePathOf(parent)}/`
    const target = `${prefix}${name}`.replace(/\/{2,}/g, '/')

    try {
      if (kind === 'folder') {
        await window.roster.skills.createFolder(skill, target)
      } else {
        const path = await window.roster.skills.createFile(skill, target)
        setOpenPath(path)
      }
      setSkills(await window.roster.skills.list())
      setCreating(null)
      setError(null)
    } catch (cause) {
      // The row stays open so the name can be corrected rather than retyped.
      setError(messageFor(cause))
    }
  }

  /**
   * Deletes the row whose icon was pressed. The confirmation lives in the
   * main process, so nothing is destroyed without it.
   */
  async function remove(row: TreeRow): Promise<void> {
    try {
      const deleted =
        row.depth === 0
          ? await window.roster.skills.removeSkill(row.skill.name)
          : await window.roster.skills.remove(row.skill.name, relativePathOf(row))

      // Cancelled at the dialog: leave everything as it was.
      if (!deleted) return

      setSkills(await window.roster.skills.list())
      if (row.key === selectedKey) setSelectedKey(null)

      // Clear the editor if what it was showing has gone — either the file
      // itself, or a folder or skill that contained it. Containment is
      // checked against the deleted folder, not merely its skill.
      if (openPath !== null && containsOpenFile(row, openPath)) setOpenPath(null)

      setError(null)
    } catch (cause) {
      setError(messageFor(cause))
    }
  }

  async function save(): Promise<void> {
    if (!openPath) return
    try {
      await window.roster.skills.write(openPath, contents)
      setSaved(contents)
      setError(null)
    } catch (cause) {
      setError(messageFor(cause))
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <ScreenHeader title="Skills">
        <span className="font-mono text-md text-dim">~/roster/skills</span>
        <div className="ml-auto flex gap-[8px]">
          <GhostButton onClick={() => void reveal()}>Reveal in Finder</GhostButton>
          <GhostButton onClick={() => void addSkill()}>Add skill</GhostButton>
          <PrimaryButton onClick={() => void createSkill()}>
            {busy ? 'Creating…' : 'New skill'}
          </PrimaryButton>
        </div>
      </ScreenHeader>

      <div className="flex min-h-0 flex-1">
        <nav className="w-tree flex-none overflow-y-auto border-r border-line bg-rail px-[8px] py-[10px]">
          {rows.length === 0 ? (
            <p className="m-0 px-[8px] text-md text-dim">No skills yet.</p>
          ) : (
            visibleRows.map((row) => (
              <Fragment key={row.key}>
                <TreeRowView
                  row={row}
                  isOpen={row.path !== undefined && row.path === openPath}
                  isSelected={row.key === selectedKey}
                  isExpanded={!collapsed.has(row.key)}
                  onToggle={() => toggleFolder(row.key)}
                  onSelect={() => {
                    setSelectedKey(row.key)
                    // A folder or skill row selects without changing the editor.
                    if (row.path) setOpenPath(row.path)
                  }}
                  onCreate={(kind) => {
                    // The name row goes inside this one, so it has to be open.
                    setCollapsed((current) => withRevealed(current, row.key))
                    setCreating({ kind, parent: row })
                  }}
                  onDelete={() => void remove(row)}
                />

                {creating?.parent.key === row.key ? (
                  <NewEntryRow
                    kind={creating.kind}
                    depth={row.depth + 1}
                    onCommit={(name) => void createEntry(name)}
                    onCancel={() => {
                      setCreating(null)
                      setError(null)
                    }}
                  />
                ) : null}
              </Fragment>
            ))
          )}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col bg-sunken">
          <div className="flex flex-none items-center gap-[10px] border-b border-line px-[16px] py-[8px]">
            <span className="truncate font-mono text-md text-ink-3">
              {openRow ? `${openRow.skill.name} / ${openRow.name}` : 'no file open'}
            </span>
            {dirty ? (
              <>
                <span aria-hidden className="h-[5px] w-[5px] flex-none rounded-full bg-amber" />
                <span className="flex-none text-sm text-dim">unsaved</span>
              </>
            ) : null}
            <div className="ml-auto flex flex-none gap-[7px]">
              <button
                type="button"
                onClick={() => setContents(saved)}
                disabled={!dirty}
                className="cursor-pointer rounded-chip border border-line-input bg-transparent px-[10px] py-[4px] font-ui text-base text-muted hover:border-line-hover disabled:cursor-default disabled:opacity-40"
                data-hoverable
              >
                Revert
              </button>
              <button
                type="button"
                onClick={() => void save()}
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
            <CodeEditor
              value={contents}
              onChange={setContents}
              ariaLabel="Skill file contents"
            />
          )}
        </div>

        <aside className="w-meta flex flex-none flex-col gap-[16px] border-l border-line bg-rail p-[16px]">
          <section className="flex flex-col gap-[8px]">
            <SectionLabel>Used by</SectionLabel>
            {openRow
              ? agents
                  .filter((a) => a.skills.includes(openRow.skill.name))
                  .map((a) => (
                    <div key={a.id} className="flex items-center gap-[8px] text-md text-ink-3">
                      <span
                        aria-hidden
                        className="h-[6px] w-[6px] rounded-full"
                        style={{ background: statusColor(a.status) }}
                      />
                      {a.name}
                    </div>
                  ))
              : null}
            {openRow && agents.every((a) => !a.skills.includes(openRow.skill.name)) ? (
              <p className="m-0 text-md text-dim">No agents yet.</p>
            ) : null}
          </section>

          <section className="flex flex-col gap-[8px]">
            <SectionLabel>Files</SectionLabel>
            <div className="font-mono text-md leading-[1.7] text-muted-2">
              {openRow?.skill.files.map((f) => <div key={f}>{f}</div>) ?? null}
            </div>
          </section>

          <section className="flex flex-col gap-[8px]">
            <SectionLabel>Last edited</SectionLabel>
            <span className="text-md text-muted-2">
              {openRow ? relativeTime(openRow.skill.lastEditedMs) : '—'}
            </span>
          </section>
        </aside>
      </div>
    </div>
  )
}

/**
 * A skill folder, then everything inside it. Folders are shown as their own
 * rows, indented by depth, as the handoff's tree draws them.
 */
/** Whether deleting this row takes the open file with it. */
function containsOpenFile(row: TreeRow, openPath: string): boolean {
  if (row.path === openPath) return true
  if (!row.isDir) return false

  // A skill row owns everything under it; a folder row only its own subtree.
  const root =
    row.depth === 0 ? row.skill.path : `${row.skill.path}/${relativePathOf(row)}`.replace(/\/+$/, '')

  return openPath.startsWith(`${root}/`)
}

/**
 * The key prefix every row inside a folder shares. A folder's own key already
 * carries the trailing slash its path had; a skill row's key does not.
 */
function subtreePrefixOf(key: string): string {
  return key.endsWith('/') ? key : `${key}/`
}

/** Whether a collapsed folder somewhere above this row is hiding it. */
function isHidden(key: string, collapsed: ReadonlySet<string>): boolean {
  // Matched on the key, not on depth: the tree is a flat list, where a
  // grandchild sits next to its parent's siblings and looks no different.
  for (const folder of collapsed) {
    if (key !== folder && key.startsWith(subtreePrefixOf(folder))) return true
  }

  return false
}

/**
 * Reopens every folder that would hide this row, the row itself included.
 * Returns the set unchanged when nothing was hiding it, so an effect can call
 * this without setting state on every pass.
 */
function withRevealed(collapsed: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const hiding = [...collapsed].filter(
    (folder) => key === folder || key.startsWith(subtreePrefixOf(folder)),
  )
  if (hiding.length === 0) return collapsed

  const next = new Set(collapsed)
  for (const folder of hiding) next.delete(folder)
  return next
}

/** A row's path relative to its own skill, which is what the store takes. */
function relativePathOf(row: TreeRow): string {
  // The key is "<skill>/<relative path>"; the skill name is not part of it.
  return row.key.slice(row.skill.name.length + 1)
}

/* -------------------------------------------------------------------------
 * Tree rows.
 *
 * The handoff draws its icons as flat placeholders and says a real icon set
 * replaces them directly, so these are the real thing: two small glyphs that
 * appear on the row you are pointing at, the way an editor's explorer does.
 * ---------------------------------------------------------------------- */

interface TreeRowViewProps {
  row: TreeRow
  isOpen: boolean
  isSelected: boolean
  /** Folders only: whether this row's subtree is showing. */
  isExpanded: boolean
  onToggle: () => void
  onSelect: () => void
  onCreate: (kind: 'file' | 'folder') => void
  onDelete: () => void
}

function TreeRowView({
  row,
  isOpen,
  isSelected,
  isExpanded,
  onToggle,
  onSelect,
  onCreate,
  onDelete,
}: TreeRowViewProps) {
  // A skill row deletes the whole skill; anything else deletes just itself.
  // A linked one is only unlinked — the folder it points at is untouched.
  const isLinkedSkill = row.depth === 0 && row.skill.linkedFrom !== undefined
  const deleteLabel = isLinkedSkill
    ? `Remove linked skill ${row.name}`
    : row.depth === 0
      ? `Delete skill ${row.name}`
      : `Delete ${row.name}`

  return (
    <div
      // focus-within, not hover alone: the icons must be reachable by keyboard.
      className={`group flex items-center rounded-sm pr-[4px] hover:bg-[#1a1c23] focus-within:bg-[#1a1c23] ${
        isSelected ? 'bg-[#1c1e26]' : 'bg-transparent'
      }`}
    >
      {/* The indent is a column of its own, so the disclosure sits at the
          row's own level rather than inside the button that opens the file. */}
      <span
        aria-hidden
        className="flex-none"
        style={{ width: TREE_GUTTER_PX + row.depth * INDENT_PX }}
      />

      {row.isDir ? (
        <button
          type="button"
          // Announced, not merely drawn: a caret alone says nothing aloud.
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${row.name}`}
          title={`${isExpanded ? 'Collapse' : 'Expand'} ${row.name}`}
          onClick={onToggle}
          style={{ width: DISCLOSURE_PX }}
          className="flex h-[16px] flex-none cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-dim-2 hover:text-ink"
        >
          <ChevronIcon expanded={isExpanded} />
        </button>
      ) : (
        // A file keeps the column, so its name lines up with its folder's.
        <span aria-hidden className="flex-none" style={{ width: DISCLOSURE_PX }} />
      )}

      <button
        type="button"
        aria-current={isSelected ? 'true' : undefined}
        onClick={onSelect}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-[7px] border-0 bg-transparent py-[5px] pl-[4px] text-left"
      >
        <span
          // The link marker takes the icon's own slot rather than a pill
          // beside the name: the tree is narrow, and a pill cost the name
          // most of its width.
          role={isLinkedSkill ? 'img' : undefined}
          aria-label={isLinkedSkill ? 'linked' : undefined}
          aria-hidden={isLinkedSkill ? undefined : true}
          className="flex h-[13px] w-[13px] flex-none items-center justify-center"
          style={{
            color: row.isDir
              ? 'var(--color-dim-2)'
              : isOpen
                ? 'var(--color-accent)'
                : 'var(--color-off)',
          }}
        >
          {isLinkedSkill ? <LinkIcon /> : row.isDir ? <FolderIcon /> : <FileIcon />}
        </span>
        <span
          // The icon costs a little label width, so a truncated name stays
          // readable on hover rather than being lost.
          title={isLinkedSkill ? `${row.name} — linked from ${row.skill.linkedFrom}` : row.name}
          className={`truncate text-lg ${row.isDir ? 'font-ui text-ink-3' : 'font-mono text-muted'} ${isOpen ? 'text-ink' : ''}`}
        >
          {row.name}
        </span>
      </button>

      <span className="flex flex-none items-center gap-[2px] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {row.isDir ? (
          <>
            <IconButton label={`New file in ${row.name}`} onClick={() => onCreate('file')}>
              <NewFileIcon />
            </IconButton>
            <IconButton label={`New folder in ${row.name}`} onClick={() => onCreate('folder')}>
              <NewFolderIcon />
            </IconButton>
          </>
        ) : null}
        <IconButton label={deleteLabel} onClick={onDelete} destructive>
          <TrashIcon />
        </IconButton>
      </span>
    </div>
  )
}

/**
 * Leading glyphs.
 *
 * The handoff distinguishes a folder from a file by the radius of a 5px dot
 * — 1.5px against 50%. That reads as noise at that size, so shape does the
 * work instead. Colour still carries state: an open file takes the accent.
 */
function FolderIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M1.75 12.75v-9.5a.75.75 0 0 1 .75-.75h3.1a.75.75 0 0 1 .6.3l1.05 1.4h6a.75.75 0 0 1 .75.75v7.8a.75.75 0 0 1-.75.75H2.5a.75.75 0 0 1-.75-.75Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface ChevronIconProps {
  expanded: boolean
}

/**
 * The disclosure caret. Down for open, right for shut — the same mark turned,
 * so the two states read as one control rather than two different glyphs.
 */
function ChevronIcon({ expanded }: ChevronIconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d={expanded ? 'm4.5 6.5 3.5 3.5 3.5-3.5' : 'm6.5 4.5 3.5 3.5-3.5 3.5'}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** A chain link: this folder is somewhere else on disk. */
function LinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M6.4 9.6 9.6 6.4M6.9 4.3l1.4-1.4a2.6 2.6 0 0 1 3.7 3.7l-1.4 1.4M9.1 11.7l-1.4 1.4a2.6 2.6 0 0 1-3.7-3.7l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M9.25 1.75H4a.75.75 0 0 0-.75.75v11a.75.75 0 0 0 .75.75h8a.75.75 0 0 0 .75-.75V5.25Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M9.25 1.75v3.5h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

/** A page with a plus, drawn to sit on the 14px grid the rows use. */
function NewFileIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M9 1.75H4.25a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1H7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path d="M9 1.75 12.75 5.5V8" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M11.5 10v4M9.5 12h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** A folder with a plus. */
function NewFolderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M1.75 12.5v-9a1 1 0 0 1 1-1h3l1.5 2h5a1 1 0 0 1 1 1V8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M1.75 12.5a1 1 0 0 0 1 1H7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M11.5 10v4M9.5 12h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

interface NewEntryRowProps {
  kind: 'file' | 'folder'
  depth: number
  onCommit: (name: string) => void
  onCancel: () => void
}

/**
 * The inline row that appears in the tree when creating. Enter commits,
 * Escape cancels, and blurring cancels too — so it never lingers.
 */
function NewEntryRow({ kind, depth, onCommit, onCancel }: NewEntryRowProps) {
  const [name, setName] = useState('')

  return (
    <div
      className="flex items-center gap-[7px] py-[5px] pr-[8px]"
      // Past the disclosure column too, so it lines up with the names above it.
      style={{ paddingLeft: TREE_GUTTER_PX + depth * INDENT_PX + DISCLOSURE_PX }}
    >
      <span
        aria-hidden
        className="h-[5px] w-[5px] flex-none bg-accent"
        style={{ borderRadius: kind === 'folder' ? '1.5px' : '50%' }}
      />
      <input
        autoFocus
        type="text"
        value={name}
        aria-label={kind === 'folder' ? 'New folder name' : 'New file name'}
        placeholder={kind === 'folder' ? 'templates' : 'repro.py'}
        onChange={(e) => setName(e.target.value)}
        onBlur={onCancel}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim() !== '') onCommit(name.trim())
          if (e.key === 'Escape') onCancel()
        }}
        className="w-full min-w-0 rounded-sm border border-accent-line bg-accent-surface-2 px-[6px] py-[2px] font-mono text-lg text-ink outline-none placeholder:text-faint"
      />
    </div>
  )
}

function buildTree(skills: Skill[]): TreeRow[] {
  return skills.flatMap((skill) => [
    { key: skill.name, name: skill.name, depth: 0, isDir: true, skill },
    ...skill.files.map((file) => {
      const isDir = file.endsWith('/')
      const relative = isDir ? file.slice(0, -1) : file
      const segments = relative.split('/')

      return {
        key: `${skill.name}/${file}`,
        // Only the last segment is shown; the indent carries the rest.
        name: segments.at(-1) ?? relative,
        depth: segments.length,
        isDir,
        skill,
        ...(isDir ? {} : { path: `${skill.path}/${file}` }),
      }
    }),
  ])
}

