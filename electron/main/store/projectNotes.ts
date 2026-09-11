import { watch, type FSWatcher } from 'node:fs'
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Disposable } from './agents'
import { projectNotesPath, projectsDir } from './paths'

/**
 * File-backed store over `~/roster/projects/<id>/NOTES.md`.
 *
 * What a project knows that is not a task: decisions, conventions, gotchas,
 * "we tried X and it did not work". A file rather than a table, for the same
 * reason agent.toml and SKILL.md are files — a memory the user cannot read,
 * correct or delete one wrong line of is one they cannot trust.
 *
 * Shaped like SkillStore (load, watch, read, write) so an edit made in
 * another editor shows up the way an edited agent.toml does, and it publishes
 * changes like TaskStore does, because it has the same two writers: the
 * person at the keyboard, and any agent holding the `memory` tools.
 */
export class ProjectNotesStore {
  /** projectId -> the file's contents. Absent means there is no file. */
  private notes = new Map<string, string>()
  private watcher: FSWatcher | null = null
  private listeners = new Set<(projectId: string, contents: string) => void>()

  /**
   * The clock is injected so that the dates `append` writes can be asserted;
   * the real one is simply now.
   */
  constructor(private readonly now: () => Date = () => new Date()) {}

  async load(): Promise<void> {
    const root = projectsDir()
    await mkdir(root, { recursive: true })
    const entries = await readdir(root, { withFileTypes: true })

    const loaded = new Map<string, string>()
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const contents = await readFile(projectNotesPath(entry.name), 'utf8').catch(() => null)
      // A project folder without a NOTES.md is not an error — the folder is
      // created on demand and may hold something else later.
      if (contents !== null) loaded.set(entry.name, contents)
    }

    this.notes = loaded
  }

  /** The project's notes, or an empty string when it has none. */
  read(projectId: string): string {
    return this.notes.get(this.checked(projectId)) ?? ''
  }

  /**
   * The notes as an agent should be charged for them: the file, less the
   * starter block Roster wrote itself.
   *
   * That block explains the file to the person who opens it, which is worth
   * having on disk and worth nothing in a prompt — and every agent on the
   * project pays for it on every turn. Only an untouched starter is dropped:
   * once somebody has edited those words they are theirs, and theirs go to
   * the model like anything else they wrote.
   */
  body(projectId: string): string {
    const contents = this.read(projectId)
    return contents.startsWith(STARTER) ? contents.slice(STARTER.length) : contents
  }

  /** Absolute path of the file, whether or not it exists yet. */
  pathOf(projectId: string): string {
    return projectNotesPath(this.checked(projectId))
  }

  /**
   * Replaces the whole file. What the in-app editor and an external editor
   * both do, and deliberately not what an agent can do — see `append`.
   */
  async write(projectId: string, contents: string): Promise<void> {
    const path = this.pathOf(projectId)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents, 'utf8')
    this.remember(projectId, contents)
  }

  /**
   * Adds one dated, attributed line and nothing else.
   *
   * Append rather than rewrite, deliberately: an agent that can rewrite the
   * file can delete what another agent or the user wrote, and an append-only
   * log is the version of this that cannot lose work. It appends through the
   * filesystem rather than rewriting from memory, so a save the store has not
   * reloaded yet — the user typing in another editor right now — survives it.
   *
   * Returns the line as written.
   */
  async append(projectId: string, entry: { author: string; note: string }): Promise<string> {
    const path = this.pathOf(projectId)

    // One entry is one line: the brief lists them line by line, and a note
    // that spanned several would read there as several unattributed ones.
    const note = entry.note.replace(/\s+/g, ' ').trim()
    if (note === '') throw new Error('a note cannot be empty')

    const line = `- ${isoDate(this.now())} ${entry.author}: ${note}\n`

    await mkdir(dirname(path), { recursive: true })
    const existing = await readFile(path, 'utf8').catch(() => null)
    if (existing === null) await writeFile(path, STARTER, { encoding: 'utf8', flag: 'w' })

    await appendFile(path, line, 'utf8')

    // Re-read rather than concatenating what we think is there: the file may
    // have grown by somebody else's line since it was last loaded.
    this.remember(projectId, await readFile(path, 'utf8'))
    return line
  }

  /** Publishes a change and keeps the in-memory copy in step with the file. */
  private remember(projectId: string, contents: string): void {
    this.notes.set(projectId, contents)
    this.publish(projectId, contents)
  }

  /**
   * A project id is also a directory name, and it reaches this store from
   * IPC and from an agent's tool call. Anything that is not a plain id would
   * otherwise read and write wherever it pointed.
   */
  private checked(projectId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(projectId)) {
      throw new Error(`"${projectId}" is not a project id`)
    }
    return projectId
  }

  watch(onChange: (projectId: string, contents: string) => void): Disposable {
    this.listeners.add(onChange)
    this.startWatching()
    return {
      dispose: () => {
        this.listeners.delete(onChange)
        if (this.listeners.size === 0) this.stopWatching()
      },
    }
  }

  private startWatching(): void {
    if (this.watcher) return
    let pending: NodeJS.Timeout | null = null

    try {
      this.watcher = watch(projectsDir(), { recursive: true }, () => {
        if (pending) clearTimeout(pending)
        pending = setTimeout(() => {
          void this.reload()
        }, WATCH_DEBOUNCE_MS)
      })
    } catch {
      // Nothing to watch until the first project writes a note; the store
      // still works, it just will not see an external edit until reload.
    }
  }

  /** Re-reads every file and tells listeners about the ones that moved. */
  private async reload(): Promise<void> {
    const before = this.notes
    await this.load()

    for (const [projectId, contents] of this.notes) {
      if (before.get(projectId) === contents) continue
      this.publish(projectId, contents)
    }

    // A file that has gone is a change too. Without this the store, every
    // brief built from it and any open editor would go on showing notes that
    // are not there any more.
    for (const projectId of before.keys()) {
      if (this.notes.has(projectId)) continue
      this.publish(projectId, '')
    }
  }

  private publish(projectId: string, contents: string): void {
    for (const listener of this.listeners) listener(projectId, contents)
  }

  private stopWatching(): void {
    this.watcher?.close()
    this.watcher = null
  }

  dispose(): void {
    this.listeners.clear()
    this.stopWatching()
  }
}

/** Long enough that a save arriving as several events reloads once. */
const WATCH_DEBOUNCE_MS = 80

/**
 * What a fresh NOTES.md opens with.
 *
 * The file is as much the user's as the agents', so it says what it is and
 * how it is written — an agent that appends to a file with no heading leaves
 * behind something nobody knows they are allowed to edit.
 */
const STARTER = `# Project notes

What this project knows that is not a task: decisions, conventions, gotchas.
Agents append dated lines here; edit it freely, it is your file.

`

/** Local date, not UTC — a note written at 11pm belongs to that evening. */
function isoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
