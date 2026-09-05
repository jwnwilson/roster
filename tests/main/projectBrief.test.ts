import { beforeEach, describe, expect, test } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { ProjectStore } from '@main/store/projects'
import { TaskStore } from '@main/store/tasks'
import type { Project, Task, TaskComment } from '@shared/types'
import { buildProjectBrief, PROJECT_BRIEF_BUDGET } from '@main/sessions/projectBrief'

/**
 * The brief is what one agent knows about a project before it has been told
 * anything. Built against a real board, because what makes it worth reading
 * is that it says the same thing the board says.
 */

let db: Db
let projects: ProjectStore
let tasks: TaskStore
let project: Project

const NAMES: Record<string, string> = {
  debugging: 'Debugging Agent',
  review: 'Review Agent',
}

const agentName = (id: string): string | null => NAMES[id] ?? null

beforeEach(() => {
  db = openDatabase(':memory:')
  projects = new ProjectStore(db)
  tasks = new TaskStore(db, agentName)
  project = projects.create({
    name: 'API reliability',
    color: '#7c5cff',
    description: 'Retries and pool exhaustion under load.',
  })
})

/** Every comment on every task filed under the project, as the manager gathers it. */
function commentsOf(filed: readonly Task[]): TaskComment[] {
  return filed.flatMap((task) => tasks.comments(task.id))
}

function brief(notes?: string): string {
  const filed = tasks.findAll().filter((task) => task.projectId === project.id)
  return buildProjectBrief({
    project,
    tasks: filed,
    comments: commentsOf(filed),
    agentName,
    ...(notes !== undefined ? { notes } : {}),
  })
}

describe('buildProjectBrief', () => {
  test('names the project and repeats its description', () => {
    const text = brief()

    expect(text).toContain('Project: API reliability')
    expect(text).toContain('Retries and pool exhaustion under load.')
  })

  test('lists open tasks with their status, priority, title and assignee', () => {
    const task = tasks.create({
      title: 'Fix connection pool leak on 504',
      priority: 'high',
      projectId: project.id,
    })
    tasks.apply(task.id, { field: 'assignee', value: 'debugging' }, {
      name: 'You',
      tone: 'you',
    })

    expect(brief()).toContain(
      `- ${task.id} [in_progress] high — Fix connection pool leak on 504 (Debugging Agent)`,
    )
  })

  test('puts open tasks before done ones', () => {
    const open = tasks.create({ title: 'Still open', projectId: project.id })
    const shut = tasks.create({ title: 'Already shipped', projectId: project.id })
    tasks.apply(shut.id, { field: 'status', value: 'done' }, { name: 'You', tone: 'you' })

    const text = brief()
    expect(text.indexOf(open.id)).toBeLessThan(text.indexOf(shut.id))
    expect(text.indexOf('Open tasks')).toBeLessThan(text.indexOf('Done'))
  })

  test('carries what one agent said on a task to the next one', () => {
    const task = tasks.create({ title: 'Fix pool leak', projectId: project.id })
    tasks.comment(task.id, {
      author: 'Debugging Agent',
      tone: 'agent',
      text: 'release() double-frees when the 504 handler retries.',
    })

    expect(brief()).toContain(
      `- Debugging Agent on ${task.id}: release() double-frees when the 504 handler retries.`,
    )
  })

  test('puts the newest comment first', () => {
    const task = tasks.create({ title: 'Fix pool leak', projectId: project.id })
    tasks.comment(task.id, { author: 'Debugging Agent', tone: 'agent', text: 'first thing' })
    tasks.comment(task.id, { author: 'Review Agent', tone: 'agent', text: 'second thing' })

    const text = brief()
    expect(text.indexOf('second thing')).toBeLessThan(text.indexOf('first thing'))
  })

  test('leaves out the History lines the board writes for itself', () => {
    const task = tasks.create({ title: 'Fix pool leak', projectId: project.id })
    tasks.apply(task.id, { field: 'status', value: 'in_review' }, { name: 'You', tone: 'you' })

    // The move produced a History entry; it is already implied by the status
    // the task list shows, so repeating it would spend budget saying nothing.
    expect(brief()).not.toContain('Recent comments')
  })

  test('stays inside the budget and says how much it left out', () => {
    for (let n = 0; n < 60; n += 1) {
      tasks.create({
        title: `Task number ${n} with a title long enough to cost real characters`,
        projectId: project.id,
      })
    }

    const text = brief()
    expect(text.length).toBeLessThanOrEqual(PROJECT_BRIEF_BUDGET)
    expect(text).toMatch(/\(\+\d+ more tasks — use list_tasks\)/)
  })

  test('admits to the comments it could not fit', () => {
    const task = tasks.create({ title: 'Fix pool leak', projectId: project.id })
    for (let n = 0; n < 40; n += 1) {
      tasks.comment(task.id, {
        author: 'Debugging Agent',
        tone: 'agent',
        text: `Finding number ${n}, written out at enough length to cost real characters.`,
      })
    }

    const text = brief()
    expect(text.length).toBeLessThanOrEqual(PROJECT_BRIEF_BUDGET)
    expect(text).toMatch(/\(\+\d+ more comments — use read_task\)/)
  })

  test('names an assignee Roster no longer knows by its id rather than dropping it', () => {
    const task = tasks.create({ title: 'Orphaned', projectId: project.id })
    tasks.apply(task.id, { field: 'assignee', value: 'deleted-agent' }, {
      name: 'You',
      tone: 'you',
    })

    expect(brief()).toContain('(deleted-agent)')
  })

  test('says nothing about what it left out when nothing was left out', () => {
    tasks.create({ title: 'The only task', projectId: project.id })

    expect(brief()).not.toContain('more tasks')
  })

  test('omits a section the project has nothing for', () => {
    const text = brief()

    expect(text).not.toContain('Open tasks')
    expect(text).not.toContain('Recent comments')
  })

  test('ignores tasks filed under another project', () => {
    const other = projects.create({ name: 'Billing', color: '#fff', description: '' })
    tasks.create({ title: 'Not ours', projectId: other.id })

    expect(brief()).not.toContain('Not ours')
  })
})

describe('buildProjectBrief — notes', () => {
  test('puts the notes above the board', () => {
    tasks.create({ title: 'A task', projectId: project.id })

    const text = brief('We tried a connection pool per region and it did not help.')
    expect(text).toContain('We tried a connection pool per region and it did not help.')
    expect(text.indexOf('Project notes')).toBeLessThan(text.indexOf('Open tasks'))
  })

  test('never lets the notes crowd the board out', () => {
    const task = tasks.create({ title: 'The one open task', projectId: project.id })
    const huge = Array.from({ length: 400 }, (_, n) => `- note line ${n}`).join('\n')

    const text = brief(huge)
    expect(text.length).toBeLessThanOrEqual(PROJECT_BRIEF_BUDGET)
    expect(text).toContain(task.id)
    expect(text).toMatch(/\(\+\d+ earlier lines — use recall\)/)
  })

  test('keeps the newest notes when it cannot keep them all', () => {
    // `remember` appends, so the recent end of the file is the bottom of it.
    // Cutting from the bottom would mean that the longer a project ran, the
    // less of what it had just learned reached the next agent.
    const long = [
      ...Array.from({ length: 60 }, (_, n) => `- 2026-01-01 Debugging Agent: stale finding ${n}`),
      '- 2026-09-05 Review Agent: the thing we worked out today',
    ].join('\n')

    const text = brief(long)
    expect(text).toContain('the thing we worked out today')
    expect(text).not.toContain('stale finding 0')
  })

  test('says the lines it dropped were the earlier ones, above the ones it kept', () => {
    const long = Array.from(
      { length: 60 },
      (_, n) => `- 2026-01-01 Debugging Agent: finding ${n}`,
    ).join('\n')

    const text = brief(long)
    const trailer = text.match(/\(\+\d+ earlier lines — use recall\)/)
    expect(trailer).not.toBeNull()
    // The dropped lines came off the top, so the admission belongs there too.
    expect(text.indexOf(trailer?.[0] as string)).toBeLessThan(text.indexOf('finding 59'))
  })

  test('leaves the notes in the order the file has them', () => {
    const text = brief('# Conventions\n\n- one pool per process\n- retries are idempotent')

    expect(text.indexOf('# Conventions')).toBeLessThan(text.indexOf('one pool per process'))
    expect(text.indexOf('one pool per process')).toBeLessThan(text.indexOf('retries are idempotent'))
  })

  test('says nothing at all about notes when the file is empty', () => {
    expect(brief('   \n\n')).not.toContain('Project notes')
  })
})
