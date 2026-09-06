import { describe, expect, test } from 'vitest'
import {
  ALL_TASKS,
  COL_GAP,
  MARGIN,
  NODE_HEIGHT,
  NODE_WIDTH,
  ROW_GAP,
  flowEdges,
  layoutFlow,
  visibleFlowIds,
} from '@/state/workflow'
import { ALL_PROJECTS } from '@/state/store'
import { aSession } from './factories'

/** A session handed off from `parent`, which is the only edge Roster records. */
function child(id: string, parent: string, overrides = {}) {
  return aSession({
    id,
    origin: 'agent',
    spawnedFrom: { agentId: 'a', sessionId: parent, label: 'from' },
    ...overrides,
  })
}

describe('flowEdges', () => {
  test('draws an edge from the handing-off session to the one it opened', () => {
    // Arrange
    const sessions = [aSession({ id: 'root' }), child('kid', 'root')]

    // Act
    const edges = flowEdges(sessions)

    // Assert
    expect(edges).toEqual([{ from: 'root', to: 'kid' }])
  })

  test('a session nobody opened has no edge', () => {
    expect(flowEdges([aSession({ id: 'root' })])).toEqual([])
  })

  test('drops an edge whose parent is not among the sessions', () => {
    // A deleted parent leaves the child behind; an edge to nothing would
    // draw a line from the origin of the canvas.
    expect(flowEdges([child('orphan', 'gone')])).toEqual([])
  })
})

describe('visibleFlowIds', () => {
  const sessions = [
    aSession({ id: 'root', taskId: 'ROS-101', projectId: 'proj-a' }),
    child('kid', 'root', { projectId: 'proj-a' }),
    child('grandkid', 'kid', { projectId: 'proj-a' }),
    aSession({ id: 'unrelated', projectId: 'proj-a' }),
    aSession({ id: 'elsewhere', taskId: 'ROS-102', projectId: 'proj-b' }),
  ]
  const edges = flowEdges(sessions)

  test('shows every session when nothing is filtered', () => {
    // Act
    const ids = visibleFlowIds(sessions, edges, {
      projectFilter: ALL_PROJECTS,
      taskFilter: ALL_TASKS,
    })

    // Assert
    expect([...ids].sort()).toEqual(['elsewhere', 'grandkid', 'kid', 'root', 'unrelated'])
  })

  test('narrows to one project', () => {
    const ids = visibleFlowIds(sessions, edges, {
      projectFilter: 'proj-b',
      taskFilter: ALL_TASKS,
    })

    expect([...ids]).toEqual(['elsewhere'])
  })

  test('a task pulls in the sessions its work was handed on to', () => {
    // The whole point: the descendants carry no taskId of their own, so
    // only walking the handoff edges finds them.
    const ids = visibleFlowIds(sessions, edges, {
      projectFilter: ALL_PROJECTS,
      taskFilter: 'ROS-101',
    })

    expect([...ids].sort()).toEqual(['grandkid', 'kid', 'root'])
  })

  test('a task reaches back to the session that handed the work over', () => {
    // Seeded from the middle of a chain: the walk is undirected, so the
    // session that started it comes along rather than being cut off.
    const chain = [
      aSession({ id: 'root' }),
      child('kid', 'root', { taskId: 'ROS-101' }),
      child('grandkid', 'kid'),
    ]

    const ids = visibleFlowIds(chain, flowEdges(chain), {
      projectFilter: ALL_PROJECTS,
      taskFilter: 'ROS-101',
    })

    expect([...ids].sort()).toEqual(['grandkid', 'kid', 'root'])
  })

  test('the project filter still applies to what the task walk reaches', () => {
    const ids = visibleFlowIds(sessions, edges, {
      projectFilter: 'proj-b',
      taskFilter: 'ROS-101',
    })

    expect([...ids]).toEqual([])
  })

  test('a task nothing is filed under shows an empty graph', () => {
    const ids = visibleFlowIds(sessions, edges, {
      projectFilter: ALL_PROJECTS,
      taskFilter: 'ROS-999',
    })

    expect([...ids]).toEqual([])
  })

  test('sessions under an archived project are left out', () => {
    const ids = visibleFlowIds(sessions, edges, {
      projectFilter: ALL_PROJECTS,
      taskFilter: ALL_TASKS,
      archived: new Set(['proj-b']),
    })

    expect(ids.has('elsewhere')).toBe(false)
    expect(ids.has('root')).toBe(true)
  })
})

describe('layoutFlow', () => {
  test('a chain of handoffs runs left to right, one column per hop', () => {
    // Arrange
    const sessions = [aSession({ id: 'root' }), child('kid', 'root'), child('grandkid', 'kid')]

    // Act
    const { positions } = layoutFlow(sessions, flowEdges(sessions))

    // Assert
    expect(positions['root']?.x).toBe(MARGIN)
    expect(positions['kid']?.x).toBe(MARGIN + NODE_WIDTH + COL_GAP)
    expect(positions['grandkid']?.x).toBe(MARGIN + 2 * (NODE_WIDTH + COL_GAP))
    // One rank each, so nothing stacks.
    expect(positions['kid']?.y).toBe(MARGIN)
  })

  test('two sessions handed off from the same one stack in the same column', () => {
    const sessions = [aSession({ id: 'root' }), child('one', 'root'), child('two', 'root')]

    const { positions } = layoutFlow(sessions, flowEdges(sessions))

    expect(positions['one']?.x).toBe(positions['two']?.x)
    expect(positions['two']?.y).toBe(MARGIN + NODE_HEIGHT + ROW_GAP)
  })

  test("children sit next to their own parent, not at the end of the rank", () => {
    // Two roots, each with a child. Ranked naively the children land in
    // creation order and the edges cross; walked depth-first they do not.
    const sessions = [
      aSession({ id: 'root-a', createdAt: 1 }),
      aSession({ id: 'root-b', createdAt: 2 }),
      child('kid-b', 'root-b', { createdAt: 3 }),
      child('kid-a', 'root-a', { createdAt: 4 }),
    ]

    const { positions } = layoutFlow(sessions, flowEdges(sessions))

    expect(positions['kid-a']?.y).toBeLessThan(positions['kid-b']?.y ?? 0)
  })

  test('the canvas is big enough for every node', () => {
    const sessions = [aSession({ id: 'root' }), child('one', 'root'), child('two', 'root')]

    const { width, height } = layoutFlow(sessions, flowEdges(sessions))

    expect(width).toBe(2 * MARGIN + 2 * NODE_WIDTH + COL_GAP)
    expect(height).toBe(2 * MARGIN + 2 * NODE_HEIGHT + ROW_GAP)
  })

  test('an empty graph still has a canvas', () => {
    const { width, height, paths } = layoutFlow([], [])

    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
    expect(paths).toEqual([])
  })

  test('one path per edge, leaving the parent and arriving at the child', () => {
    const sessions = [aSession({ id: 'root' }), child('kid', 'root')]

    const { paths, positions } = layoutFlow(sessions, flowEdges(sessions))

    const root = positions['root']
    const kid = positions['kid']
    expect(paths).toHaveLength(1)
    expect(paths[0]).toContain(`M ${(root?.x ?? 0) + NODE_WIDTH} ${(root?.y ?? 0) + NODE_HEIGHT / 2}`)
    expect(paths[0]).toContain(`${kid?.x} ${(kid?.y ?? 0) + NODE_HEIGHT / 2}`)
  })

  test('a cycle written into the data by hand does not hang the layout', () => {
    // Impossible through the app — a session's parent always predates it —
    // but a layout that spins on bad data takes the whole window with it.
    const sessions = [child('a', 'b'), child('b', 'a')]

    const { positions } = layoutFlow(sessions, flowEdges(sessions))

    expect(Object.keys(positions).sort()).toEqual(['a', 'b'])
  })
})
