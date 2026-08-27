import { beforeEach, describe, expect, test } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { ProjectStore } from '@main/store/projects'
import { TaskStore } from '@main/store/tasks'
import { SessionStore } from '@main/store/sessions'

let db: Db
let projects: ProjectStore
let tasks: TaskStore
let sessions: SessionStore

beforeEach(() => {
  db = openDatabase(':memory:')
  projects = new ProjectStore(db)
  tasks = new TaskStore(db)
  sessions = new SessionStore(db)
})

describe('ProjectStore.create', () => {
  test('stores what it was given and hands back the whole project', () => {
    const created = projects.create({
      name: 'API reliability',
      color: 'var(--color-project-4)',
      description: 'Close out connection-handling bugs.',
    })

    expect(created).toMatchObject({
      name: 'API reliability',
      color: 'var(--color-project-4)',
      description: 'Close out connection-handling bugs.',
    })
    expect(projects.findById(created.id)).toEqual(created)
  })

  test('a project without a description gets an empty one, never undefined', () => {
    const created = projects.create({ name: 'Untitled', color: 'red' })
    expect(created.description).toBe('')
  })

  test('lists projects in creation order', () => {
    projects.create({ name: 'First', color: 'a' })
    projects.create({ name: 'Second', color: 'b' })

    expect(projects.findAll().map((p) => p.name)).toEqual(['First', 'Second'])
  })
})

describe('ProjectStore.update', () => {
  test('changes only the fields it was handed', () => {
    const created = projects.create({ name: 'Old', color: 'a', description: 'keep me' })

    const updated = projects.update(created.id, { name: 'New' })

    expect(updated.name).toBe('New')
    expect(updated.description).toBe('keep me')
    expect(updated.color).toBe('a')
  })

  test('refuses to update a project that does not exist', () => {
    expect(() => projects.update('nope', { name: 'x' })).toThrow('unknown project "nope"')
  })
})

describe('ProjectStore.delete', () => {
  test('detaches its tasks rather than deleting them', () => {
    const project = projects.create({ name: 'Doomed', color: 'a' })
    const task = tasks.create({ title: 'Survives', projectId: project.id })

    projects.delete(project.id)

    // Losing a grouping must never lose the work that was grouped.
    const after = tasks.findById(task.id)
    expect(after).not.toBeNull()
    expect(after?.projectId).toBeNull()
  })

  test('detaches its sessions rather than deleting them', () => {
    const project = projects.create({ name: 'Doomed', color: 'a' })
    const session = sessions.create({ agentId: 'debug', title: 'Work', origin: 'you' })
    db.prepare('UPDATE sessions SET project_id = ? WHERE id = ?').run(project.id, session.id)

    projects.delete(project.id)

    const row = db.prepare('SELECT project_id FROM sessions WHERE id = ?').get(session.id) as
      | { project_id: string | null }
      | undefined
    expect(row).toBeDefined()
    expect(row?.project_id).toBeNull()
  })

  test('removes it from the list', () => {
    const project = projects.create({ name: 'Doomed', color: 'a' })
    projects.delete(project.id)

    expect(projects.findAll()).toHaveLength(0)
    expect(projects.findById(project.id)).toBeNull()
  })
})
