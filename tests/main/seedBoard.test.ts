import { beforeEach, describe, expect, test } from 'vitest'
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
  const AGENTS = [anAgentRecord({ id: 'architect', name: 'Architect Agent' })]

  test('never seeds a project or task on a fresh install', () => {
    expect(seedBoardIfEmpty(projects, tasks, AGENTS)).toBe(false)

    expect(projects.findAll()).toHaveLength(0)
    expect(tasks.findAll()).toHaveLength(0)
  })

  test('leaves the board empty regardless of which agents are on the roster', () => {
    expect(seedBoardIfEmpty(projects, tasks, [])).toBe(false)

    expect(projects.findAll()).toHaveLength(0)
    expect(tasks.findAll()).toHaveLength(0)
  })

  test('does not disturb a board a user has already started', () => {
    tasks.create({ title: 'Existing' })
    projects.create({ name: 'Mine', color: 'a' })

    expect(seedBoardIfEmpty(projects, tasks, AGENTS)).toBe(false)
    expect(tasks.findAll()).toHaveLength(1)
    expect(projects.findAll()).toHaveLength(1)
  })
})
