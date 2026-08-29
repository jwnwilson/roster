import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  columnOf,
  columnsFor,
  moveTask,
  reduceTaskEvent,
  selectBacklogTasks,
  selectFilteredTasks,
  useRoster,
  withTask,
} from '@/state/store'
import { aProject, aTask, aTaskComment } from './factories'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()

beforeEach(() => {
  useRoster.setState(INITIAL, true)
})

/** The reducer takes whole state, so read it back after seeding. */
function state() {
  return useRoster.getState()
}

describe('reduceTaskEvent — creation', () => {
  test('adds a task the board has not seen', () => {
    const task = aTask({ id: 'ROS-9' })

    const patch = reduceTaskEvent(state(), { type: 'task-created', task })

    expect(patch.tasks).toEqual([task])
  })

  test('ignores one it already has, so our own create is not doubled', () => {
    const task = aTask({ id: 'ROS-9' })
    useRoster.setState({ tasks: [task] })

    const patch = reduceTaskEvent(state(), { type: 'task-created', task })

    // The outcome, not the shape of the patch: it hands back the very same
    // array, so there is one task and nothing re-renders over it.
    expect(patch.tasks).toEqual([task])
    expect(patch.tasks).toBe(state().tasks)
  })
})

describe('reduceTaskEvent — updates', () => {
  test('replaces the task in place', () => {
    useRoster.setState({ tasks: [aTask({ id: 'ROS-1', status: 'todo' })] })
    const moved = aTask({ id: 'ROS-1', status: 'done' })

    const patch = reduceTaskEvent(state(), { type: 'task-updated', task: moved })

    expect(patch.tasks).toEqual([moved])
  })

  test('leaves other tasks alone', () => {
    useRoster.setState({ tasks: [aTask({ id: 'ROS-1' }), aTask({ id: 'ROS-2' })] })

    const patch = reduceTaskEvent(state(), {
      type: 'task-updated',
      task: aTask({ id: 'ROS-1', title: 'Renamed' }),
    })

    expect(patch.tasks?.map((t) => t.title)).toEqual([
      'Renamed',
      'Fix connection pool leak on 504',
    ])
  })
})

describe('reduceTaskEvent — deletion', () => {
  test('drops the task and its thread', () => {
    useRoster.setState({
      tasks: [aTask({ id: 'ROS-1' })],
      taskComments: { 'ROS-1': [aTaskComment()] },
    })

    const patch = reduceTaskEvent(state(), { type: 'task-deleted', taskId: 'ROS-1' })

    expect(patch.tasks).toEqual([])
    expect(patch.taskComments).toEqual({})
  })

  test('closes the modal when it was showing that task', () => {
    // Leaving it open would point the detail view at nothing.
    useRoster.setState({ tasks: [aTask({ id: 'ROS-1' })], openTaskId: 'ROS-1' })

    const patch = reduceTaskEvent(state(), { type: 'task-deleted', taskId: 'ROS-1' })

    expect(patch.openTaskId).toBeNull()
  })

  test('leaves a modal showing a different task open', () => {
    useRoster.setState({
      tasks: [aTask({ id: 'ROS-1' }), aTask({ id: 'ROS-2' })],
      openTaskId: 'ROS-2',
    })

    const patch = reduceTaskEvent(state(), { type: 'task-deleted', taskId: 'ROS-1' })

    expect(patch.openTaskId).toBeUndefined()
  })
})

describe('reduceTaskEvent — comments', () => {
  test('appends to a thread that is open', () => {
    useRoster.setState({ taskComments: { 'ROS-101': [] } })
    const comment = aTaskComment({ id: 'c2', text: 'from an agent' })

    const patch = reduceTaskEvent(state(), { type: 'comment', taskId: 'ROS-101', comment })

    expect(patch.taskComments?.['ROS-101']).toEqual([comment])
  })

  test('ignores one for a thread nobody has opened', () => {
    // It will be read in full when the task is opened; buffering it here
    // would half-populate a thread and hide the rest.
    const patch = reduceTaskEvent(state(), {
      type: 'comment',
      taskId: 'ROS-101',
      comment: aTaskComment(),
    })

    expect(patch).toEqual({})
  })

  test('ignores one it already has', () => {
    const comment = aTaskComment({ id: 'c1' })
    useRoster.setState({ taskComments: { 'ROS-101': [comment] } })

    expect(
      reduceTaskEvent(state(), { type: 'comment', taskId: 'ROS-101', comment }),
    ).toEqual({})
  })
})

describe('reduceTaskEvent — projects', () => {
  test('replaces the project list wholesale', () => {
    const projects = [aProject({ id: 'p1' })]

    const patch = reduceTaskEvent(state(), { type: 'projects', projects })

    expect(patch.projects).toEqual(projects)
  })
})

describe('columnOf — what a drop landed on', () => {
  const TASKS = [aTask({ id: 'ROS-1', status: 'todo' }), aTask({ id: 'ROS-2', status: 'done' })]

  test('a column id resolves to itself', () => {
    expect(columnOf('in_review', TASKS)).toBe('in_review')
  })

  test('a card id resolves to the column that card is in', () => {
    // Dropping onto a card means dropping into its column.
    expect(columnOf('ROS-2', TASKS)).toBe('done')
  })

  test('anything else resolves to nothing, rather than guessing', () => {
    expect(columnOf('ROS-404', TASKS)).toBeNull()
  })
})

describe('moveTask', () => {
  test('moves the card and writes the change', async () => {
    useRoster.setState({ tasks: [aTask({ id: 'ROS-1', status: 'todo' })] })
    const api = installRosterApi({
      tasks: { apply: vi.fn().mockResolvedValue(aTask({ id: 'ROS-1', status: 'done' })) },
    })

    const error = await moveTask('ROS-1', 'done')

    expect(error).toBeNull()
    expect(api.tasks.apply).toHaveBeenCalledWith('ROS-1', { field: 'status', value: 'done' })
    expect(useRoster.getState().tasks[0]?.status).toBe('done')
  })

  test('moves the card before the write lands', async () => {
    useRoster.setState({ tasks: [aTask({ id: 'ROS-1', status: 'todo' })] })
    let resolve: (value: unknown) => void = () => {}
    installRosterApi({
      tasks: { apply: vi.fn().mockReturnValue(new Promise((r) => (resolve = r))) },
    })

    const pending = moveTask('ROS-1', 'in_review')

    // A card that hangs where it was dropped reads as a broken drag.
    expect(useRoster.getState().tasks[0]?.status).toBe('in_review')
    resolve(aTask({ id: 'ROS-1', status: 'in_review' }))
    await pending
  })

  test('puts the card back when the write fails, and says why', async () => {
    useRoster.setState({ tasks: [aTask({ id: 'ROS-1', status: 'todo' })] })
    installRosterApi({
      tasks: { apply: vi.fn().mockRejectedValue(new Error('database is locked')) },
    })

    const error = await moveTask('ROS-1', 'done')

    // Leaving it moved after a failed write would be a lie.
    expect(useRoster.getState().tasks[0]?.status).toBe('todo')
    expect(error).toBe('database is locked')
  })

  test('does nothing when the card is already in that column', async () => {
    useRoster.setState({ tasks: [aTask({ id: 'ROS-1', status: 'done' })] })
    const api = installRosterApi()

    expect(await moveTask('ROS-1', 'done')).toBeNull()
    expect(api.tasks.apply).not.toHaveBeenCalled()
  })

  test('does nothing for a task that is not on the board', async () => {
    const api = installRosterApi()

    expect(await moveTask('ROS-404', 'done')).toBeNull()
    expect(api.tasks.apply).not.toHaveBeenCalled()
  })
})

describe('a task we created ourselves arrives twice', () => {
  const CREATED = aTask({ id: 'ROS-9', title: 'Just made' })

  test('the broadcast landing first does not leave two of it', () => {
    // The real order: the main process emits before the create call returns,
    // so the modal's own add is the second one to land. Guarding only the
    // broadcast — as this once did — showed every new task twice.
    useRoster.setState({ tasks: [] })
    useRoster.setState((s) => reduceTaskEvent(s, { type: 'task-created', task: CREATED }))

    useRoster.setState((s) => ({ tasks: withTask(s.tasks, CREATED) }))

    expect(useRoster.getState().tasks).toHaveLength(1)
  })

  test('and neither does our own add landing first', () => {
    useRoster.setState({ tasks: [] })
    useRoster.setState((s) => ({ tasks: withTask(s.tasks, CREATED) }))

    useRoster.setState((s) => reduceTaskEvent(s, { type: 'task-created', task: CREATED }))

    expect(useRoster.getState().tasks).toHaveLength(1)
  })

  test('a task that really is new is still added', () => {
    useRoster.setState({ tasks: [aTask({ id: 'ROS-1' })] })

    useRoster.setState((s) => ({ tasks: withTask(s.tasks, CREATED) }))

    expect(useRoster.getState().tasks.map((t) => t.id)).toEqual(['ROS-1', 'ROS-9'])
  })

  test('a no-op keeps the same array, so nothing re-renders over it', () => {
    const tasks = [CREATED]

    expect(withTask(tasks, CREATED)).toBe(tasks)
  })
})

describe('the board and the backlog divide the tasks between them', () => {
  const TASKS = [
    aTask({ id: 'ROS-1', title: 'On the board', status: 'todo', projectId: 'p1' }),
    aTask({ id: 'ROS-2', title: 'An idea', status: 'backlog', priority: 'low', projectId: 'p1' }),
    aTask({ id: 'ROS-3', title: 'Another idea', status: 'backlog', priority: 'urgent' }),
  ]

  beforeEach(() => {
    useRoster.setState({ tasks: TASKS })
  })

  test('the board never shows backlog work', () => {
    expect(selectFilteredTasks(useRoster.getState()).map((t) => t.id)).toEqual(['ROS-1'])
  })

  test('the backlog shows only backlog work', () => {
    expect(selectBacklogTasks(useRoster.getState()).map((t) => t.id)).toEqual(['ROS-2', 'ROS-3'])
  })

  test('the two searches are separate, since they search different lists', () => {
    useRoster.setState({ taskQuery: 'On the board', backlogQuery: 'Another' })

    expect(selectFilteredTasks(useRoster.getState()).map((t) => t.id)).toEqual(['ROS-1'])
    expect(selectBacklogTasks(useRoster.getState()).map((t) => t.id)).toEqual(['ROS-3'])
  })

  test('the backlog matches on the task key too', () => {
    useRoster.setState({ backlogQuery: 'ros-3' })

    expect(selectBacklogTasks(useRoster.getState()).map((t) => t.id)).toEqual(['ROS-3'])
  })

  test('the priority filter narrows the backlog', () => {
    useRoster.setState({ backlogPriority: 'urgent' })

    expect(selectBacklogTasks(useRoster.getState()).map((t) => t.id)).toEqual(['ROS-3'])
  })

  test('the project filter is the shared one, and reaches both lists', () => {
    useRoster.setState({ projectFilter: 'p1' })

    expect(selectFilteredTasks(useRoster.getState()).map((t) => t.id)).toEqual(['ROS-1'])
    expect(selectBacklogTasks(useRoster.getState()).map((t) => t.id)).toEqual(['ROS-2'])
  })

  test('grouping drops anything that is not a column, rather than throwing', () => {
    // columnsFor indexes a four-key record by status; a backlog task that
    // slipped past the filter would take the whole board down with it.
    const columns = columnsFor(TASKS)

    expect(columns.todo.map((t) => t.id)).toEqual(['ROS-1'])
    expect(Object.keys(columns)).toEqual(['todo', 'in_progress', 'in_review', 'done'])
  })

  test('a backlog task is not a drop target, so nothing can be dropped onto it', () => {
    expect(columnOf('ROS-2', TASKS)).toBeNull()
    expect(columnOf('backlog', TASKS)).toBeNull()
  })
})
