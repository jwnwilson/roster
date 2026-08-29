import { beforeEach, describe, expect, test } from 'vitest'
import { BOARD_STATUSES } from '@shared/types'
import { openDatabase, type Db } from '@main/db'
import { ProjectStore } from '@main/store/projects'
import { TaskStore } from '@main/store/tasks'
import { seedBoardIfEmpty } from '@main/store/seedBoard'
import { anAgentRecord } from './fixtures/agents'

let db: Db
let projects: ProjectStore
let tasks: TaskStore

beforeEach(() => {
  db = openDatabase(':memory:')
  projects = new ProjectStore(db)
  tasks = new TaskStore(db)
})

describe('seedBoardIfEmpty', () => {
  const AGENTS = [
    anAgentRecord({ id: 'architect', name: 'Architect Agent' }),
    anAgentRecord({ id: 'debugging', name: 'Debugging Agent' }),
    anAgentRecord({ id: 'review', name: 'Review Agent' }),
    anAgentRecord({ id: 'estimation', name: 'Estimation Agent' }),
  ]

  test('fills an empty board with projects and tasks', () => {
    expect(seedBoardIfEmpty(projects, tasks, AGENTS)).toBe(true)

    expect(projects.findAll().length).toBeGreaterThan(0)
    expect(tasks.findAll().length).toBeGreaterThan(0)
  })

  test('puts work in every column, so the board is not one long To Do list', () => {
    seedBoardIfEmpty(projects, tasks, AGENTS)

    const seeded = new Set(tasks.findAll().map((task) => task.status))
    for (const column of BOARD_STATUSES) expect(seeded).toContain(column)
  })

  test('seeds the backlog too, so the tab is not an empty pane on a fresh install', () => {
    seedBoardIfEmpty(projects, tasks, AGENTS)

    const backlog = tasks.findAll().filter((task) => task.status === 'backlog')
    expect(backlog.length).toBeGreaterThan(0)
    // Nobody has picked these up — that is what makes them backlog.
    expect(backlog.every((task) => task.assigneeId === null)).toBe(true)
  })

  test('files every seeded task under a project that exists', () => {
    seedBoardIfEmpty(projects, tasks, AGENTS)

    const ids = new Set(projects.findAll().map((project) => project.id))
    for (const task of tasks.findAll()) {
      expect(task.projectId).not.toBeNull()
      expect(ids.has(task.projectId as string)).toBe(true)
    }
  })

  test('leaves a task unassigned when its demo agent is not on this roster', () => {
    // A user who seeded their own roster should not see cards attributed to
    // agents they have never had.
    seedBoardIfEmpty(projects, tasks, [])

    for (const task of tasks.findAll()) expect(task.assigneeId).toBeNull()
  })

  test('advances the key counter, so the next real task does not collide', () => {
    seedBoardIfEmpty(projects, tasks, AGENTS)
    const seeded = new Set(tasks.findAll().map((task) => task.id))

    const created = tasks.create({ title: 'Mine' })

    expect(seeded.has(created.id)).toBe(false)
  })

  test('seeds nothing when the board already has a task', () => {
    tasks.create({ title: 'Existing' })

    expect(seedBoardIfEmpty(projects, tasks, AGENTS)).toBe(false)
    expect(tasks.findAll()).toHaveLength(1)
  })

  test('seeds nothing when the board already has a project', () => {
    projects.create({ name: 'Mine', color: 'a' })

    expect(seedBoardIfEmpty(projects, tasks, AGENTS)).toBe(false)
    expect(projects.findAll()).toHaveLength(1)
  })

  test('writes the demo conversation as comments, not as History', () => {
    seedBoardIfEmpty(projects, tasks, AGENTS)

    const withThread = tasks
      .findAll()
      .flatMap((task) => tasks.comments(task.id))
    expect(withThread.length).toBeGreaterThan(0)
    // Nothing in the seed happened, so nothing should be logged as though
    // it had.
    expect(withThread.every((comment) => !comment.isSystem)).toBe(true)
  })
})
