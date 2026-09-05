import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openDatabase } from '@main/db'
import { ProjectStore } from '@main/store/projects'
import { ProjectNotesStore } from '@main/store/projectNotes'
import { projectNotesPath } from '@main/store/paths'

/**
 * `~/roster/projects/<id>/NOTES.md` — what a project knows that is not a
 * task. Shaped like SkillStore, because it is the same kind of thing: a file
 * the user owns, watched for edits made outside Roster.
 */

let home: string
let notes: ProjectNotesStore

/**
 * A fixed clock, so the dates an append writes can be asserted. Built from
 * local parts rather than a UTC string, so the expected date below holds
 * wherever the suite runs.
 */
const NOON = new Date(2026, 8, 5, 12, 0, 0)

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'roster-notes-'))
  process.env['ROSTER_HOME'] = home
  notes = new ProjectNotesStore(() => NOON)
  await notes.load()
})

afterEach(async () => {
  notes.dispose()
  delete process.env['ROSTER_HOME']
  await rm(home, { recursive: true, force: true })
})

/** Waits for a watcher to notice. Watching is debounced; polling beats sleeping. */
async function until(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise((done) => setTimeout(done, 20))
  }
  throw new Error(`timed out waiting for ${label}`)
}

describe('ProjectNotesStore', () => {
  test('has nothing to say about a project nobody has written notes for', () => {
    expect(notes.read('p1')).toBe('')
  })

  test('writes and reads back', async () => {
    await notes.write('p1', '# Notes\n\nWe use one pool per process.\n')

    expect(notes.read('p1')).toContain('We use one pool per process.')
  })

  test('keeps one project’s notes out of another’s', async () => {
    await notes.write('p1', 'ours')
    await notes.write('p2', 'theirs')

    expect(notes.read('p1')).toBe('ours')
    expect(notes.read('p2')).toBe('theirs')
  })

  test('picks up an edit made outside Roster', async () => {
    await notes.write('p1', 'before')

    let seen: string | null = null
    const watcher = notes.watch((projectId, contents) => {
      if (projectId === 'p1') seen = contents
    })

    await writeFile(projectNotesPath('p1'), 'after', 'utf8')
    await until(() => seen !== null, 'the watcher to see the external edit')

    expect(seen).toBe('after')
    expect(notes.read('p1')).toBe('after')
    watcher.dispose()
  })
})

describe('ProjectNotesStore.append', () => {
  test('dates and attributes the line it adds', async () => {
    await notes.append('p1', {
      author: 'Debugging Agent',
      note: 'release() double-frees when the 504 handler retries.',
    })

    expect(notes.read('p1')).toContain(
      '- 2026-09-05 Debugging Agent: release() double-frees when the 504 handler retries.',
    )
  })

  test('starts the file off with something a person can read', async () => {
    await notes.append('p1', { author: 'Debugging Agent', note: 'a finding' })

    expect(notes.read('p1')).toMatch(/^# Project notes/)
  })

  test('keeps every line, oldest first', async () => {
    await notes.append('p1', { author: 'Debugging Agent', note: 'the first thing' })
    await notes.append('p1', { author: 'Review Agent', note: 'the second thing' })

    const body = notes.read('p1')
    expect(body).toContain('the first thing')
    expect(body).toContain('the second thing')
    expect(body.indexOf('the first thing')).toBeLessThan(body.indexOf('the second thing'))
  })

  test('never loses a write it did not make', async () => {
    await notes.append('p1', { author: 'Debugging Agent', note: 'what the agent found' })

    // The user edits NOTES.md in another editor while the agent is running,
    // and the store has not reloaded yet. An append that rewrote the whole
    // file from memory would erase this.
    const path = projectNotesPath('p1')
    const edited = `${await readFile(path, 'utf8')}\nWhat the user wrote by hand.\n`
    await writeFile(path, edited, 'utf8')

    await notes.append('p1', { author: 'Review Agent', note: 'what the reviewer found' })

    const onDisk = await readFile(path, 'utf8')
    expect(onDisk).toContain('What the user wrote by hand.')
    expect(onDisk).toContain('what the agent found')
    expect(onDisk).toContain('what the reviewer found')
  })

  test('flattens a multi-line note, so one entry stays one line', async () => {
    await notes.append('p1', { author: 'Debugging Agent', note: 'first\n\nsecond' })

    expect(notes.read('p1')).toContain('- 2026-09-05 Debugging Agent: first second')
  })

  test('refuses an empty note rather than writing a blank line', async () => {
    await expect(notes.append('p1', { author: 'Debugging Agent', note: '  ' })).rejects.toThrow(
      /empty/i,
    )
  })

  test('tells anyone watching, so an open editor is not left stale', async () => {
    let seen: string | null = null
    const watcher = notes.watch((projectId, contents) => {
      if (projectId === 'p1') seen = contents
    })

    await notes.append('p1', { author: 'Debugging Agent', note: 'a finding' })

    expect(seen).toContain('a finding')
    watcher.dispose()
  })
})

describe('notes and the project they belong to', () => {
  test('survive the project being renamed', async () => {
    const db = openDatabase(':memory:')
    const projects = new ProjectStore(db)
    const project = projects.create({ name: 'API reliability', color: '#7c5cff' })

    await notes.append(project.id, { author: 'Debugging Agent', note: 'a finding' })
    projects.update(project.id, { name: 'Platform reliability' })

    // The folder is keyed on the id, so the name is free to change and two
    // projects with the same name cannot land in the same folder.
    expect(notes.read(project.id)).toContain('a finding')
    expect(projectNotesPath(project.id)).toContain(project.id)
  })

  test('refuse a project id that would walk out of the notes folder', async () => {
    await expect(
      notes.append('../../escape', { author: 'Debugging Agent', note: 'a finding' }),
    ).rejects.toThrow()
    expect(() => notes.read('../../escape')).toThrow()
  })
})
