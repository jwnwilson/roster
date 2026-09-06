/**
 * The Agents screen's Workflow view: the roster's sessions as a graph.
 *
 * Pure functions over sessions, so the filtering and the arithmetic are
 * testable without rendering anything. Each returns fresh values — call them
 * inside useMemo, never through `useRoster(selector)`, which loops on new
 * references.
 *
 * Nothing new is stored to draw this. A handoff already records `spawnedFrom`
 * on the session it opened, and a mention already records `taskId` on the
 * session it opened, and the renderer already holds every session. So the
 * graph is derived, and a handed-off session deliberately does not inherit
 * its parent's task: the unique index on (task_id, agent_id) allows one
 * session per agent per task, which an A→B→A chain would break. Walking the
 * edges finds them instead.
 */

import type { Session } from '@shared/types'
import { ALL_PROJECTS, ALL_TASKS } from './store'

// Re-exported so a caller drawing the graph needs only this module. Defined
// in the store beside ALL_PROJECTS, which is where a reader looks for it and
// which keeps the dependency one-way.
export { ALL_TASKS }

/* -------------------------------------------------------------------------
 * Layout constants — the design handoff's Workflow view, § Roster.dc.html.
 * ---------------------------------------------------------------------- */

export const NODE_WIDTH = 200
export const NODE_HEIGHT = 64
/** Between columns, which is between one handoff and the next. */
export const COL_GAP = 88
/** Between siblings in a column. */
export const ROW_GAP = 22
export const MARGIN = 24

export interface FlowEdge {
  /** The session that handed the work over. */
  from: string
  /** The session it opened. */
  to: string
}

export interface FlowPosition {
  x: number
  y: number
}

export interface FlowLayout {
  positions: Record<string, FlowPosition>
  /** One SVG path per edge, in the order the edges were given. */
  paths: string[]
  width: number
  height: number
}

/**
 * Every handoff, as an edge.
 *
 * An edge whose parent is not in `sessions` is dropped rather than drawn:
 * a deleted parent would otherwise leave a line running back to the origin
 * of the canvas.
 */
export function flowEdges(sessions: readonly Session[]): FlowEdge[] {
  const present = new Set(sessions.map((session) => session.id))

  return sessions.flatMap((session) => {
    const parent = session.spawnedFrom?.sessionId
    if (parent === undefined || !present.has(parent)) return []
    return [{ from: parent, to: session.id }]
  })
}

export interface FlowFilter {
  /** ALL_PROJECTS, or a project id. */
  projectFilter: string
  /** ALL_TASKS, or a task id. */
  taskFilter: string
  /** Projects that have been archived; their work is off every surface. */
  archived?: ReadonlySet<string>
}

const NO_ARCHIVED: ReadonlySet<string> = new Set()

/**
 * Which sessions the two filters leave on the canvas.
 *
 * The task filter is not a property test. Only the sessions a mention opened
 * carry the task, so matching on `taskId` alone would show the first agent
 * and hide everyone it handed the work to. Instead those sessions seed a walk
 * along the edges — undirected, so the chain is followed forwards to whoever
 * ended up doing the work and backwards to whoever started it — and the
 * project filter is applied to the result.
 */
export function visibleFlowIds(
  sessions: readonly Session[],
  edges: readonly FlowEdge[],
  { projectFilter, taskFilter, archived = NO_ARCHIVED }: FlowFilter,
): Set<string> {
  const inProject = new Set(
    sessions
      .filter((session) => {
        const projectId = session.projectId ?? null
        if (projectId !== null && archived.has(projectId)) return false
        return projectFilter === ALL_PROJECTS || projectId === projectFilter
      })
      .map((session) => session.id),
  )

  if (taskFilter === ALL_TASKS) return inProject

  const reachable = componentOf(
    sessions.filter((session) => session.taskId === taskFilter).map((session) => session.id),
    edges,
  )

  return new Set([...inProject].filter((id) => reachable.has(id)))
}

/** Everything joined to a seed by any chain of handoffs, in either direction. */
function componentOf(seeds: readonly string[], edges: readonly FlowEdge[]): Set<string> {
  const neighbours = new Map<string, string[]>()
  const join = (from: string, to: string): void => {
    const existing = neighbours.get(from)
    if (existing) existing.push(to)
    else neighbours.set(from, [to])
  }
  for (const edge of edges) {
    join(edge.from, edge.to)
    join(edge.to, edge.from)
  }

  const seen = new Set(seeds)
  const queue = [...seeds]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const next of neighbours.get(current) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }

  return seen
}

/**
 * Where every node and edge goes: ranks left to right, siblings down.
 *
 * A session has at most one parent, so this is a forest and a layered pass is
 * enough — no crossing minimisation and so no layout dependency. Ranks are
 * walked depth-first from the roots rather than filled in creation order, so
 * a parent's children sit beside it instead of wherever they happened to be
 * created, which is what keeps the edges from crossing.
 */
export function layoutFlow(sessions: readonly Session[], edges: readonly FlowEdge[]): FlowLayout {
  const children = new Map<string, string[]>()
  const parents = new Map<string, string[]>()
  for (const edge of edges) {
    children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to])
    parents.set(edge.to, [...(parents.get(edge.to) ?? []), edge.from])
  }

  const ranks = rankAll(sessions, parents)
  const rows = orderRanks(sessions, children, ranks)

  const positions: Record<string, FlowPosition> = {}
  for (const [id, row] of rows) {
    positions[id] = {
      x: MARGIN + (ranks.get(id) ?? 0) * (NODE_WIDTH + COL_GAP),
      y: MARGIN + row * (NODE_HEIGHT + ROW_GAP),
    }
  }

  const columns = Math.max(1, ...[...ranks.values()].map((rank) => rank + 1))
  const deepest = Math.max(1, ...[...rows.values()].map((row) => row + 1))

  return {
    positions,
    paths: edges.flatMap((edge) => {
      const from = positions[edge.from]
      const to = positions[edge.to]
      if (!from || !to) return []
      return [edgePath(from, to)]
    }),
    width: 2 * MARGIN + columns * (NODE_WIDTH + COL_GAP) - COL_GAP,
    height: 2 * MARGIN + deepest * (NODE_HEIGHT + ROW_GAP) - ROW_GAP,
  }
}

/**
 * Each session's column: one past its deepest parent.
 *
 * `seen` bounds the walk. A session's parent always predates it, so a cycle
 * cannot be made through the app — but one hand-written into the database
 * would otherwise spin here and take the window down with it.
 */
function rankAll(
  sessions: readonly Session[],
  parents: ReadonlyMap<string, string[]>,
): Map<string, number> {
  const ranks = new Map<string, number>()

  const rankOf = (id: string, seen: Set<string>): number => {
    const known = ranks.get(id)
    if (known !== undefined) return known
    if (seen.has(id)) return 0

    seen.add(id)
    const above = parents.get(id) ?? []
    const rank = above.length === 0 ? 0 : Math.max(...above.map((from) => rankOf(from, seen))) + 1

    ranks.set(id, rank)
    return rank
  }

  for (const session of sessions) rankOf(session.id, new Set())
  return ranks
}

/** Which row each node takes within its own column. */
function orderRanks(
  sessions: readonly Session[],
  children: ReadonlyMap<string, string[]>,
  ranks: ReadonlyMap<string, number>,
): Map<string, number> {
  const oldestFirst = [...sessions].sort((a, b) => a.createdAt - b.createdAt)
  const byId = new Map(oldestFirst.map((session) => [session.id, session]))
  const nextRow = new Map<number, number>()
  const rows = new Map<string, number>()

  const place = (id: string): void => {
    if (rows.has(id)) return
    const rank = ranks.get(id) ?? 0
    const row = nextRow.get(rank) ?? 0
    rows.set(id, row)
    nextRow.set(rank, row + 1)

    const below = [...(children.get(id) ?? [])].sort(
      (a, b) => (byId.get(a)?.createdAt ?? 0) - (byId.get(b)?.createdAt ?? 0),
    )
    for (const kid of below) place(kid)
  }

  // Roots first, so each subtree is laid out whole; anything left is inside
  // a cycle and is placed where it falls.
  for (const session of oldestFirst) if (ranks.get(session.id) === 0) place(session.id)
  for (const session of oldestFirst) place(session.id)

  return rows
}

/** The handoff's own curve: out of the parent's right edge, into the child's left. */
function edgePath(from: FlowPosition, to: FlowPosition): string {
  const ax = from.x + NODE_WIDTH
  const ay = from.y + NODE_HEIGHT / 2
  const bx = to.x
  const by = to.y + NODE_HEIGHT / 2
  const midX = (ax + bx) / 2

  return `M ${ax} ${ay} C ${midX} ${ay} ${midX} ${by} ${bx} ${by}`
}
