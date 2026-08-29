import type { TaskPriority, TaskStatus } from './types'

/**
 * How tasks render, and how the board narrates itself.
 *
 * Modelled on ./status.ts, and shared for the same reason: the History lines
 * below are written both by a person dragging a card and by an agent calling
 * `update_task`, and those two must produce the same sentence. Anything that
 * decides wording lives here so there is one copy of it.
 */

interface TaskStatusStyle {
  cssVar: string
  /** The handoff's column heading, which is not the raw key. */
  label: string
}

const STATUS_STYLES: Record<TaskStatus, TaskStatusStyle> = {
  backlog: { cssVar: 'var(--color-backlog)', label: 'Backlog' },
  todo: { cssVar: 'var(--color-todo)', label: 'To Do' },
  in_progress: { cssVar: 'var(--color-in-progress)', label: 'In Progress' },
  in_review: { cssVar: 'var(--color-in-review)', label: 'In Review' },
  done: { cssVar: 'var(--color-done)', label: 'Done' },
}

const PRIORITY_STYLES: Record<TaskPriority, TaskStatusStyle> = {
  urgent: { cssVar: 'var(--color-priority-urgent)', label: 'Urgent' },
  high: { cssVar: 'var(--color-priority-high)', label: 'High' },
  medium: { cssVar: 'var(--color-priority-medium)', label: 'Medium' },
  low: { cssVar: 'var(--color-priority-low)', label: 'Low' },
}

export function taskStatusLabel(status: TaskStatus): string {
  return STATUS_STYLES[status].label
}

export function taskStatusColor(status: TaskStatus): string {
  return STATUS_STYLES[status].cssVar
}

export function taskPriorityLabel(priority: TaskPriority): string {
  return PRIORITY_STYLES[priority].label
}

export function taskPriorityColor(priority: TaskPriority): string {
  return PRIORITY_STYLES[priority].cssVar
}

/** The swatch picker in the Projects modal, in the handoff's order. */
export const PROJECT_COLORS: readonly string[] = Object.freeze([
  'var(--color-project-0)',
  'var(--color-project-1)',
  'var(--color-project-2)',
  'var(--color-project-3)',
  'var(--color-project-4)',
  'var(--color-project-5)',
])

/* -------------------------------------------------------------------------
 * History wording. Each returns one sentence, exactly as the design
 * prototype phrases it.
 * ---------------------------------------------------------------------- */

export function movedLine(actorName: string, status: TaskStatus): string {
  return `${actorName} moved this to ${taskStatusLabel(status)}.`
}

export function pickedUpLine(agentName: string): string {
  return `${agentName} picked up this task.`
}

export function unassignedLine(): string {
  return 'Unassigned.'
}

export function priorityLine(priority: TaskPriority): string {
  return `Changed priority to ${taskPriorityLabel(priority)}.`
}

export function labelAddedLine(label: string): string {
  return `Added label ${label}.`
}

export function labelRemovedLine(label: string): string {
  return `Removed label ${label}.`
}

/**
 * The 18×18 assignee chip shows initials. An agent named "Debugging Agent"
 * reads better as DE than DA — the first word is what distinguishes it, since
 * every agent's second word is "Agent".
 */
export function initialsFor(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? ''
  return first.slice(0, 2).toUpperCase()
}
