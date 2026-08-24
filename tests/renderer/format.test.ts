import { describe, expect, test } from 'vitest'
import { formatCost, formatTokens } from '@/state/format'

describe('formatTokens', () => {
  test('shows small counts exactly', () => {
    expect(formatTokens(315)).toBe('315 tok')
  })

  test('abbreviates thousands the way the handoff writes them', () => {
    expect(formatTokens(86_120)).toBe('86.1k tok')
  })

  test('abbreviates millions', () => {
    expect(formatTokens(2_400_000)).toBe('2.4M tok')
  })

  test('switches unit exactly at the boundary', () => {
    expect(formatTokens(999)).toBe('999 tok')
    expect(formatTokens(1_000)).toBe('1.0k tok')
    expect(formatTokens(999_999)).toBe('1000.0k tok')
    expect(formatTokens(1_000_000)).toBe('1.0M tok')
  })

  test('an agent that has never run reads as zero, not blank', () => {
    expect(formatTokens(0)).toBe('0 tok')
  })

  test('survives a missing or nonsense total', () => {
    // Better a zero on the card than "NaN tok".
    expect(formatTokens(Number.NaN)).toBe('0 tok')
    expect(formatTokens(-5)).toBe('0 tok')
  })
})

describe('formatCost', () => {
  test('shows dollars and cents', () => {
    expect(formatCost(0.91)).toBe('$0.91')
    expect(formatCost(12)).toBe('$12.00')
  })

  test('rounds sub-cent spend to zero rather than growing a decimal', () => {
    // Columns line up across cards; a third decimal would break that.
    expect(formatCost(0.0007)).toBe('$0.00')
  })

  test('survives a missing or nonsense figure', () => {
    expect(formatCost(Number.NaN)).toBe('$0.00')
    expect(formatCost(0)).toBe('$0.00')
  })
})
