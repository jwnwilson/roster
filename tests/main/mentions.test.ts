import { describe, expect, test } from 'vitest'
import { parseMentions } from '@shared/mentions'

const ROSTER = ['tech-lead', 'debugging-agent']

describe('parseMentions', () => {
  test('finds a mention and says where it sits in the text', () => {
    expect(parseMentions('ask @tech-lead about this', ROSTER)).toEqual([
      { agentId: 'tech-lead', start: 4, end: 14 },
    ])
  })

  test('the offsets bracket the token, so a composer can replace it', () => {
    const text = 'ask @tech-lead about this'
    const [mention] = parseMentions(text, ROSTER)

    expect(text.slice(mention?.start, mention?.end)).toBe('@tech-lead')
  })

  test('treats an id nobody has as ordinary text', () => {
    // People write @here and @me without meaning an agent by it.
    expect(parseMentions('ping @nobody about this', ROSTER)).toEqual([])
  })

  test('does not read an email address as a mention', () => {
    expect(parseMentions('noel@tech-lead wrote it', ROSTER)).toEqual([])
  })

  test('matches whatever case it was typed in', () => {
    expect(parseMentions('@Tech-Lead please look', ROSTER)).toMatchObject([
      { agentId: 'tech-lead' },
    ])
  })

  test('mentions one agent once, however often it is named', () => {
    expect(parseMentions('@tech-lead and again @tech-lead', ROSTER)).toHaveLength(1)
  })

  test('keeps two different agents, in the order they were named', () => {
    expect(parseMentions('@debugging-agent then @tech-lead', ROSTER)).toMatchObject([
      { agentId: 'debugging-agent' },
      { agentId: 'tech-lead' },
    ])
  })

  test('finds nothing in text with no mention in it', () => {
    expect(parseMentions('just a comment', ROSTER)).toEqual([])
  })

  test('does not match a longer id by its prefix', () => {
    // Sending the question to an agent the author did not name would be
    // worse than doing nothing.
    expect(parseMentions('@tech-lead-two', ROSTER)).toEqual([])
  })
})
