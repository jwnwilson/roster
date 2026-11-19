import { describe, expect, test } from 'vitest'
import { MATCH_CLOSE, MATCH_OPEN, splitSnippet } from '../../shared/search'
import { toMatchExpression } from '@main/store/sessions'

describe('splitSnippet', () => {
  test('separates matched runs from the text around them, in order', () => {
    const snippet = `fill with ${MATCH_OPEN}vinegar${MATCH_CLOSE} and boil`

    expect(splitSnippet(snippet)).toEqual([
      { text: 'fill with ', matched: false },
      { text: 'vinegar', matched: true },
      { text: ' and boil', matched: false },
    ])
  })

  test('a snippet with no match is one plain run', () => {
    expect(splitSnippet('nothing here')).toEqual([{ text: 'nothing here', matched: false }])
  })

  test('an empty snippet has no runs', () => {
    expect(splitSnippet('')).toEqual([])
  })

  test('handles a match at either end', () => {
    expect(splitSnippet(`${MATCH_OPEN}a${MATCH_CLOSE}b${MATCH_OPEN}c${MATCH_CLOSE}`)).toEqual([
      { text: 'a', matched: true },
      { text: 'b', matched: false },
      { text: 'c', matched: true },
    ])
  })
})

describe('toMatchExpression', () => {
  test('quotes every word and makes only the last one a prefix', () => {
    expect(toMatchExpression('stack overflow')).toBe('"stack" "overflow"*')
  })

  test('doubles embedded quotes so they are literal', () => {
    expect(toMatchExpression('say "hi"')).toBe('"say" """hi"""*')
  })

  test('is null for nothing to search', () => {
    expect(toMatchExpression('  \t ')).toBeNull()
  })
})
