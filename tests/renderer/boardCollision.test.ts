import { beforeEach, describe, expect, test, vi } from 'vitest'

const { closestCorners, pointerWithin } = vi.hoisted(() => ({
  closestCorners: vi.fn(),
  pointerWithin: vi.fn(),
}))

vi.mock('@dnd-kit/core', () => ({ closestCorners, pointerWithin }))

import { boardCollisionDetection } from '@/state/board'

describe('boardCollisionDetection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('keeps the column directly under the pointer as the drop target', () => {
    const pointerHits = [{ id: 'in_review' }]
    pointerWithin.mockReturnValue(pointerHits)

    expect(boardCollisionDetection({} as Parameters<typeof boardCollisionDetection>[0])).toBe(pointerHits)
    expect(closestCorners).not.toHaveBeenCalled()
  })

  test('uses closest corners when there is no pointer target, such as keyboard dragging', () => {
    const fallbackHits = [{ id: 'in_review' }]
    pointerWithin.mockReturnValue([])
    closestCorners.mockReturnValue(fallbackHits)

    expect(boardCollisionDetection({} as Parameters<typeof boardCollisionDetection>[0])).toBe(fallbackHits)
  })
})
