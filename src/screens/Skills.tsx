import { useEffect, useMemo, useState } from 'react'
import type { Skill } from '@shared/types'
import { statusColor } from '@shared/status'
import { GhostButton, PrimaryButton, ScreenHeader, SectionLabel } from '@/components/primitives'
import { useRoster } from '@/state/store'
import { messageFor } from '@/lib/errors'

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

export function Skills() {
  const skills = useRoster((s) => s.skills)
  const agents = useRoster((s) => s.agents)

  const [openPath, setOpenPath] = useState<string | null>(null)
  const [contents, setContents] = useState('')
  const [saved, setSaved] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Which kind of thing the inline row is about to create, if any. */
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null)
  /** Which tree row is selected. Files also open; folders and skills only select. */
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const setSkills = useRoster((st) => st.setSkills)

  const rows = useMemo(() => buildTree(skills), [skills])

  // Open the first SKILL.md so the editor is never empty on arrival.
  useEffect(() => {
    if (openPath !== null) return
    const first = rows.find((r) => !r.isDir && r.name === 'SKILL.md')
    if (first?.path) {
      setOpenPath(first.path)
      setSelectedKey(first.key)
    }
  }, [rows, openPath])

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

  /** Creates inside whichever skill is open, then opens the result. */
  async function createEntry(name: string): Promise<void> {
    const skill = openRow?.skill.name ?? skills[0]?.name
    if (skill === undefined || creating === null) return

    try {
      if (creating === 'folder') {
        await window.roster.skills.createFolder(skill, name)
      } else {
        const path = await window.roster.skills.createFile(skill, name)
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
   * Deletes whatever is selected. The confirmation lives in the main process,
   * so nothing is destroyed without it.
   */
  async function remove(): Promise<void> {
    if (selected === null) return

    try {
      const deleted =
        selected.depth === 0
          ? await window.roster.skills.removeSkill(selected.skill.name)
          : await window.roster.skills.remove(selected.skill.name, relativePathOf(selected))

      // Cancelled at the dialog: leave everything as it was.
      if (!deleted) return

      setSkills(await window.roster.skills.list())
      setSelectedKey(null)
      // The open file may have been what was deleted.
      if (selected.path === openPath || selected.depth === 0) setOpenPath(null)
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
          <GhostButton onClick={() => setCreating('file')}>New file</GhostButton>
          <GhostButton onClick={() => setCreating('folder')}>New folder</GhostButton>
          <GhostButton onClick={() => void remove()}>
            {selected === null ? 'Delete' : `Delete ${selected.name}`}
          </GhostButton>
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
            rows.map((row) => {
              const active = row.path !== undefined && row.path === openPath
              return (
                <button
                  key={row.key}
                  type="button"
                  aria-current={row.key === selectedKey ? 'true' : undefined}
                  onClick={() => {
                    setSelectedKey(row.key)
                    // A folder or skill row selects without changing the editor.
                    if (row.path) setOpenPath(row.path)
                  }}
                  style={{ paddingLeft: 12 + row.depth * 14 }}
                  className={`flex w-full cursor-pointer items-center gap-[7px] rounded-sm border-0 py-[5px] pr-[8px] text-left hover:bg-[#1a1c23] ${
                    row.key === selectedKey ? 'bg-[#1c1e26]' : 'bg-transparent'
                  }`}
                >
                  <span
                    aria-hidden
                    className="h-[5px] w-[5px] flex-none"
                    style={{
                      borderRadius: row.isDir ? '1.5px' : '50%',
                      background: row.isDir
                        ? 'var(--color-dim-2)'
                        : active
                          ? 'var(--color-accent)'
                          : 'var(--color-off)',
                    }}
                  />
                  <span
                    className={`truncate text-lg ${row.isDir ? 'font-ui text-ink-3' : 'font-mono text-muted'} ${active ? 'text-ink' : ''}`}
                  >
                    {row.name}
                  </span>
                </button>
              )
            })
          )}

          {creating !== null ? (
            <NewEntryRow
              kind={creating}
              onCommit={(name) => void createEntry(name)}
              onCancel={() => {
                setCreating(null)
                setError(null)
              }}
            />
          ) : null}
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
            <textarea
              value={contents}
              aria-label="Skill file contents"
              onChange={(e) => setContents(e.target.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none border-0 bg-transparent px-[20px] py-[14px] font-mono text-lg leading-[1.75] text-ink-2 outline-none"
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
/** A row's path relative to its own skill, which is what the store takes. */
function relativePathOf(row: TreeRow): string {
  // The key is "<skill>/<relative path>"; the skill name is not part of it.
  return row.key.slice(row.skill.name.length + 1)
}

interface NewEntryRowProps {
  kind: 'file' | 'folder'
  onCommit: (name: string) => void
  onCancel: () => void
}

/**
 * The inline row that appears in the tree when creating. Enter commits,
 * Escape cancels, and blurring cancels too — so it never lingers.
 */
function NewEntryRow({ kind, onCommit, onCancel }: NewEntryRowProps) {
  const [name, setName] = useState('')

  return (
    <div className="flex items-center gap-[7px] py-[5px] pr-[8px] pl-[26px]">
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

export function relativeTime(ms: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - ms) / 1000))
  if (seconds < 60) return 'just now'

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
