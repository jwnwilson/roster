import { describe, expect, test } from 'vitest'
import { parseQuestions, summariseQuestions } from '@main/runners/questions'

const ONE = [
  {
    question: 'Which cache backend?',
    header: 'Cache',
    multiSelect: false,
    options: [
      { label: 'Redis', description: 'Distributed, for multi-instance deployments' },
      { label: 'In-memory', description: 'Fast, single instance only' },
    ],
  },
]

describe('parseQuestions', () => {
  test('reads a question and its options', () => {
    expect(parseQuestions(ONE)).toEqual([
      {
        question: 'Which cache backend?',
        header: 'Cache',
        multiSelect: false,
        options: [
          { label: 'Redis', description: 'Distributed, for multi-instance deployments' },
          { label: 'In-memory', description: 'Fast, single instance only' },
        ],
      },
    ])
  })

  test('carries multiSelect through, since it changes what a click means', () => {
    expect(parseQuestions([{ ...ONE[0], multiSelect: true }])?.[0]?.multiSelect).toBe(true)
  })

  test('treats a missing multiSelect as single-select', () => {
    const { multiSelect: _dropped, ...withoutIt } = ONE[0]!
    expect(parseQuestions([withoutIt])?.[0]?.multiSelect).toBe(false)
  })

  test('falls back to the question when there is no header to chip', () => {
    const { header: _dropped, ...withoutIt } = ONE[0]!
    expect(parseQuestions([withoutIt])?.[0]?.header).toBe('Which cache backend?')
  })

  test('an option may describe nothing', () => {
    const options = [{ label: 'Redis' }, { label: 'None' }]
    expect(parseQuestions([{ ...ONE[0], options }])?.[0]?.options).toEqual([
      { label: 'Redis', description: '' },
      { label: 'None', description: '' },
    ])
  })

  test('refuses a question with no options, which would render no buttons', () => {
    expect(parseQuestions([{ question: 'Which one?', options: [] }])).toBeNull()
  })

  test('refuses an option with no label, rather than drawing an empty button', () => {
    expect(parseQuestions([{ ...ONE[0], options: [{ description: 'no label' }] }])).toBeNull()
  })

  test('refuses the whole set when one question is malformed', () => {
    // Half a set is worse than none: the rest of the call still needs
    // allowing or denying, and the banner can do that.
    expect(parseQuestions([...ONE, { question: 'Broken?' }])).toBeNull()
  })

  test('refuses anything that is not a list of questions', () => {
    expect(parseQuestions(undefined)).toBeNull()
    expect(parseQuestions([])).toBeNull()
    expect(parseQuestions('Which one?')).toBeNull()
    expect(parseQuestions([null])).toBeNull()
  })

  test('refuses a blank question, which would be a card asking nothing', () => {
    expect(parseQuestions([{ ...ONE[0], question: '   ' }])).toBeNull()
  })
})

describe('summariseQuestions', () => {
  test('is more forgiving than the parser, since a line needs no options', () => {
    // The row and the banner should still read as what was asked even when
    // there is nothing good enough to click.
    expect(summariseQuestions([{ question: 'Which one?' }])).toBe('Which one?')
    expect(parseQuestions([{ question: 'Which one?' }])).toBeNull()
  })

  test('counts the ones it could not fit', () => {
    expect(summariseQuestions([{ question: 'First?' }, { question: 'Second?' }])).toBe(
      'First? (+1 more)',
    )
  })

  test('has nothing to say about a malformed call', () => {
    expect(summariseQuestions([])).toBeNull()
    expect(summariseQuestions([{ header: 'Cache' }])).toBeNull()
    expect(summariseQuestions(undefined)).toBeNull()
  })
})
