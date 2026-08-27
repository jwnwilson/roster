import { describe, expect, test } from 'vitest'
import { TASK_PRIORITIES, TASK_STATUSES } from '@shared/types'
import {
  PROJECT_COLORS,
  initialsFor,
  labelAddedLine,
  labelRemovedLine,
  movedLine,
  pickedUpLine,
  priorityLine,
  taskPriorityColor,
  taskPriorityLabel,
  taskStatusColor,
  taskStatusLabel,
  unassignedLine,
} from '@shared/tasks'

describe('task vocabulary', () => {
  test('every status has a colour and a label', () => {
    for (const status of TASK_STATUSES) {
      expect(taskStatusColor(status)).toMatch(/^var\(--color-/)
      expect(taskStatusLabel(status)).not.toBe('')
    }
  })

  test('every priority has a colour and a label', () => {
    for (const priority of TASK_PRIORITIES) {
      expect(taskPriorityColor(priority)).toMatch(/^var\(--color-/)
      expect(taskPriorityLabel(priority)).not.toBe('')
    }
  })

  test('uses the handoff column headings rather than the raw keys', () => {
    expect(taskStatusLabel('todo')).toBe('To Do')
    expect(taskStatusLabel('in_progress')).toBe('In Progress')
    expect(taskStatusLabel('in_review')).toBe('In Review')
  })

  test('offers the six project swatches the design specifies', () => {
    expect(PROJECT_COLORS).toHaveLength(6)
    expect(new Set(PROJECT_COLORS).size).toBe(6)
  })

  test('the board orders columns left to right, most urgent priority first', () => {
    expect(TASK_STATUSES).toEqual(['todo', 'in_progress', 'in_review', 'done'])
    expect(TASK_PRIORITIES[0]).toBe('urgent')
  })
})

describe('history wording', () => {
  test('names who moved a task and where it went', () => {
    expect(movedLine('Debugging Agent', 'in_review')).toBe(
      'Debugging Agent moved this to In Review.',
    )
  })

  test('reads as the agent claiming the work, not as an assignment', () => {
    expect(pickedUpLine('Review Agent')).toBe('Review Agent picked up this task.')
  })

  test('clearing an assignee says so without naming anyone', () => {
    expect(unassignedLine()).toBe('Unassigned.')
  })

  test('a priority change spells the priority out', () => {
    expect(priorityLine('urgent')).toBe('Changed priority to Urgent.')
  })

  test('label changes name the label', () => {
    expect(labelAddedLine('migration')).toBe('Added label migration.')
    expect(labelRemovedLine('migration')).toBe('Removed label migration.')
  })

  test('every line ends in a full stop, so the log reads as prose', () => {
    const lines = [
      movedLine('You', 'done'),
      pickedUpLine('A'),
      unassignedLine(),
      priorityLine('low'),
      labelAddedLine('x'),
      labelRemovedLine('x'),
    ]
    for (const line of lines) expect(line.endsWith('.')).toBe(true)
  })
})

describe('initialsFor', () => {
  test('takes two letters from the first word, not one from each', () => {
    // Every seeded agent's second word is "Agent", so initials from both
    // words would render every avatar as "?A".
    expect(initialsFor('Debugging Agent')).toBe('DE')
    expect(initialsFor('Review Agent')).toBe('RE')
  })

  test('handles a single short name', () => {
    expect(initialsFor('Al')).toBe('AL')
    expect(initialsFor('B')).toBe('B')
  })

  test('survives surrounding whitespace and an empty name', () => {
    expect(initialsFor('  spaced  out ')).toBe('SP')
    expect(initialsFor('')).toBe('')
  })
})
