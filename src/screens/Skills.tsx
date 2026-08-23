import { useEffect, useMemo, useState } from 'react'
import type { Skill } from '@shared/types'
import { statusColor } from '@shared/status'
import { GhostButton, PrimaryButton, ScreenHeader, SectionLabel } from '@/components/primitives'
import { useRoster } from '@/state/store'

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
  const setSkills = useRoster((st) => st.setSkills)

  const rows = useMemo(() => buildTree(skills), [skills])

  // Open the first SKILL.md so the editor is never empty on arrival.
  useEffect(() => {
    if (openPath !== null) return
    const first = rows.find((r) => !r.isDir && r.name === 'SKILL.md')
    if (first?.path) setOpenPath(first.path)
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
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })

    return () => {
      cancelled = true
    }
  }, [openPath])

  const dirty = contents !== saved
  const openRow = rows.find((r) => r.path === openPath) ?? null

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
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function save(): Promise<void> {
    if (!openPath) return
    try {
      await window.roster.skills.write(openPath, contents)
      setSaved(contents)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <ScreenHeader title="Skills">
        <span className="font-mono text-md text-dim">~/roster/skills</span>
        <div className="ml-auto flex gap-[8px]">
          <GhostButton onClick={() => void reveal()}>Reveal in Finder</GhostButton>
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
                  disabled={row.isDir}
                  onClick={() => row.path && setOpenPath(row.path)}
                  style={{ paddingLeft: 12 + row.depth * 14 }}
                  className={`flex w-full items-center gap-[7px] rounded-sm border-0 py-[5px] pr-[8px] text-left ${
                    row.isDir ? 'cursor-default' : 'cursor-pointer hover:bg-[#1a1c23]'
                  } ${active ? 'bg-[#1c1e26]' : 'bg-transparent'}`}
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

function buildTree(skills: Skill[]): TreeRow[] {
  return skills.flatMap((skill) => [
    { key: skill.name, name: skill.name, depth: 0, isDir: true, skill },
    ...skill.files
      .filter((file) => !file.endsWith('/'))
      .map((file) => ({
        key: `${skill.name}/${file}`,
        name: file,
        depth: 1,
        isDir: false,
        skill,
        path: `${skill.path}/${file}`,
      })),
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
