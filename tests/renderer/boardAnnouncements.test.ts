import { describe, expect, test } from 'vitest'
import type { Active, Over } from '@dnd-kit/core'
import { boardAnnouncements } from '@/state/board'
import { aTask } from './factories'

const TASKS = [
  aTask({ id: 'ROS-1', status: 'todo' }),
  aTask({ id: 'ROS-2', status: 'done' }),
]

const announcements = boardAnnouncements(TASKS)

/** dnd-kit passes rich objects; the announcers only read `id`. */
const active = { id: 'ROS-1' } as Active
const over = (id: string): Over => ({ id }) as Over

describe('boardAnnouncements', () => {
  test('names the card that was picked up', () => {
    expect(announcements.onDragStart?.({ active })).toBe('Picked up ROS-1.')
  })

  test('names the column a card is over, not a sortable position', () => {
    // dnd-kit's default would say "position 2 of 5", which means nothing on
    // a board where the column is the whole point.
    expect(announcements.onDragOver?.({ active, over: over('in_review') })).toBe(
      'ROS-1 is over In Review.',
    )
  })

  test('resolves a card being hovered to that card\'s column', () => {
    expect(announcements.onDragOver?.({ active, over: over('ROS-2') })).toBe(
      'ROS-1 is over Done.',
    )
  })

  test('says nothing while the cursor is between columns', () => {
    // Otherwise it fires on every pixel of travel.
    expect(announcements.onDragOver?.({ active, over: null })).toBeUndefined()
  })

  test('says where the card ended up', () => {
    expect(announcements.onDragEnd?.({ active, over: over('done') })).toBe(
      'ROS-1 moved to Done.',
    )
  })

  test('says so when a drop went nowhere', () => {
    expect(announcements.onDragEnd?.({ active, over: null })).toBe(
      'ROS-1 was dropped where it started.',
    )
  })

  test('says so when a drag was cancelled', () => {
    expect(announcements.onDragCancel?.({ active, over: null })).toBe('ROS-1 was left where it was.')
  })
})
