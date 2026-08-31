import { beforeEach, describe, expect, test } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { ProjectStore } from '@main/store/projects'
import { TaskStore } from '@main/store/tasks'
import { buildTaskTools, type TaskTools } from '@main/runners/taskTools'

/**
 * The tool handlers themselves, against a real board.
 *
 * Its sibling taskTools.test.ts mocks this whole module to get hold of the
 * TaskTools the session manager builds, so the handlers have to be exercised
 * from here instead.
 */

let db: Db
let projects: ProjectStore
let tasks: TaskStore

beforeEach(() => {
  db = openDatabase(':memory:')
  projects = new ProjectStore(db)
  tasks = new TaskStore(db)
})

interface ToolResult {
  isError?: boolean
  content: { text: string }[]
}

/** A stand-in for the SDK factory: records each tool by the name it is given. */
function handlers(): Map<string, (args: never) => Promise<ToolResult>> {
  const built = new Map<string, (args: never) => Promise<ToolResult>>()
  const factory = ((name: string, _description: string, _schema: unknown, handler: never) => {
    built.set(name, handler)
    return { name }
  }) as never

  const board: TaskTools = {
    list: () => tasks.findAll(),
    find: (id) => tasks.findById(id),
    comments: (id) => tasks.comments(id),
    projectName: (id) => projects.findById(id)?.name ?? null,
    isArchivedProject: (id) => projects.findById(id)?.archivedAt != null,
    agentName: () => 'Debugging Agent',
    create: (input) => tasks.create(input),
    update: (id) => tasks.findById(id) as never,
    comment: () => {},
  }

  buildTaskTools(board, 'debugging', factory)
  return built
}

function createTask(): (args: never) => Promise<ToolResult> {
  const handler = handlers().get('create_task')
  if (!handler) throw new Error('create_task was never built')
  return handler
}

describe('create_task and archived projects', () => {
  test('refuses to file work under an archived project', async () => {
    const shipped = projects.create({ name: 'Shipped', color: 'a' })
    projects.setArchived(shipped.id, true)

    const result = await createTask()({ title: 'New work', project_id: shipped.id } as never)

    // Filing it there would create a task no board ever shows — an agent
    // told about it plainly can pick somewhere else.
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe(
      'Project "Shipped" is archived; pick an active one or none.',
    )
    expect(tasks.findAll()).toHaveLength(0)
  })

  test('files it happily under an active project', async () => {
    const live = projects.create({ name: 'API reliability', color: 'a' })

    const result = await createTask()({ title: 'New work', project_id: live.id } as never)

    expect(result.isError).toBeUndefined()
    expect(tasks.findAll()[0]?.projectId).toBe(live.id)
  })

  test('and under no project at all', async () => {
    const result = await createTask()({ title: 'New work' } as never)

    expect(result.isError).toBeUndefined()
    expect(tasks.findAll()[0]?.projectId).toBeNull()
  })

  test('a project id nobody recognises is not treated as archived', async () => {
    // Not this guard's business — the foreign key decides what an unknown id
    // means. It still surfaces raw rather than as a tool error, which is how
    // it behaved before archiving existed; what matters here is only that it
    // is never reported as an archiving problem.
    await expect(
      createTask()({ title: 'New work', project_id: 'ghost' } as never),
    ).rejects.toThrow(/FOREIGN KEY/)
  })
})
