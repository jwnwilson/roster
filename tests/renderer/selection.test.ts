import { describe, expect, test } from 'vitest'
import { quoteFromSelection } from '@/lib/selection'

/**
 * A stand-in for a DOM Selection. Only the four members the helper reads are
 * modelled, so a test states the selection rather than staging one.
 */
function aSelection(text: string, node: Node, focus: Node = node): Selection {
  return {
    isCollapsed: text === '',
    anchorNode: node,
    focusNode: focus,
    toString: () => text,
  } as unknown as Selection
}

function container(): HTMLElement {
  const root = document.createElement('div')
  const child = document.createElement('p')
  root.appendChild(child)
  return root
}

describe('quoting what you selected', () => {
  test('takes the selected text', () => {
    const root = container()

    expect(quoteFromSelection(aSelection('Archiving keeps the row.', root.firstChild!), root)).toBe(
      'Archiving keeps the row.',
    )
  })

  test('is nothing when nothing is selected', () => {
    const root = container()

    expect(quoteFromSelection(aSelection('', root.firstChild!), root)).toBeNull()
    expect(quoteFromSelection(null, root)).toBeNull()
  })

  test('is nothing when there is nowhere to have selected from', () => {
    expect(quoteFromSelection(aSelection('x', document.createElement('p')), null)).toBeNull()
  })

  test('ignores a selection made outside the plan', () => {
    const root = container()
    const elsewhere = document.createElement('p')

    // Selecting your own earlier comment is not a note about the plan.
    expect(quoteFromSelection(aSelection('something else', elsewhere), root)).toBeNull()
  })

  test('ignores a selection that only starts inside the plan', () => {
    const root = container()
    const elsewhere = document.createElement('p')

    expect(quoteFromSelection(aSelection('spanning', root.firstChild!, elsewhere), root)).toBeNull()
  })

  test('flattens the line breaks and padding that rendering put there', () => {
    const root = container()

    // What a selection across a list item and its neighbour actually yields.
    expect(quoteFromSelection(aSelection('  reproduce\n\n   patch  ', root.firstChild!), root)).toBe(
      'reproduce patch',
    )
  })

  test('is nothing when the selection is only whitespace', () => {
    const root = container()

    expect(quoteFromSelection(aSelection('   \n  ', root.firstChild!), root)).toBeNull()
  })

  test('cuts a very long passage down, and says it cut it', () => {
    const root = container()
    const quoted = quoteFromSelection(aSelection('word '.repeat(200), root.firstChild!), root)

    // Selecting the whole plan should not paste the whole plan into the note.
    expect(quoted!.length).toBeLessThanOrEqual(241)
    expect(quoted!.endsWith('…')).toBe(true)
  })

  test('leaves a passage that fits exactly alone', () => {
    const root = container()
    const exact = 'a'.repeat(240)

    expect(quoteFromSelection(aSelection(exact, root.firstChild!), root)).toBe(exact)
  })
})
