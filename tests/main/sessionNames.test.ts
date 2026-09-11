import { beforeEach, describe, expect, test } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { SessionStore } from '@main/store/sessions'
import {
  SESSION_NAME_MAX_LENGTH,
  UNNAMED_SESSION_LABEL,
  normalizeSessionName,
  sessionLabel,
} from '@shared/sessions'

describe('normalizeSessionName', () => {
  test('keeps a name somebody actually typed', () => {
    expect(normalizeSessionName('Pool leak on 504')).toBe('Pool leak on 504')
  })

  test('trims the edges', () => {
    expect(normalizeSessionName('  Pool leak  ')).toBe('Pool leak')
  })

  test('flattens the whitespace inside, so a pasted name still fits one line', () => {
    expect(normalizeSessionName('Pool\nleak\ton  504')).toBe('Pool leak on 504')
  })

  test('reads a blank name as no name at all', () => {
    // Naming is encouraged, never required: an empty box means the session
    // stays unnamed rather than acquiring a name of one space.
    expect(normalizeSessionName('')).toBeNull()
    expect(normalizeSessionName('   \n ')).toBeNull()
  })

  test('reads a missing name as no name at all', () => {
    expect(normalizeSessionName(null)).toBeNull()
    expect(normalizeSessionName(undefined)).toBeNull()
  })

  test('cuts a name that would never fit the tab it labels', () => {
    const long = 'x'.repeat(SESSION_NAME_MAX_LENGTH + 40)

    expect(normalizeSessionName(long)).toHaveLength(SESSION_NAME_MAX_LENGTH)
  })

  test('trims again after cutting, so a name never ends mid-space', () => {
    const long = `${'x'.repeat(SESSION_NAME_MAX_LENGTH - 1)}   tail`

    expect(normalizeSessionName(long)).toBe('x'.repeat(SESSION_NAME_MAX_LENGTH - 1))
  })
})

describe('sessionLabel', () => {
  test('is the name once one has been given', () => {
    expect(sessionLabel({ name: 'Pool leak', title: 'New session' })).toBe('Pool leak')
  })

  test('falls back to the title while the session is unnamed', () => {
    // Every session that predates naming is in this state, and so is every
    // handed-off one, whose title says who sent it and why.
    expect(sessionLabel({ name: null, title: 'Architect Agent · ADR-014' })).toBe(
      'Architect Agent · ADR-014',
    )
    expect(sessionLabel({ title: 'New session' })).toBe('New session')
  })

  test('never renders as nothing at all', () => {
    expect(sessionLabel({ name: null, title: '  ' })).toBe(UNNAMED_SESSION_LABEL)
  })
})

describe('SessionStore names', () => {
  let db: Db
  let store: SessionStore

  beforeEach(() => {
    db = openDatabase(':memory:')
    store = new SessionStore(db)
  })

  const create = () => store.create({ agentId: 'debugging', title: 'New session', origin: 'you' })

  test('a session starts unnamed', () => {
    expect(create().name).toBeNull()
  })

  test('naming one returns the session as it now stands', () => {
    const session = create()

    const named = store.setName(session.id, 'Pool leak on 504')

    expect(named.name).toBe('Pool leak on 504')
    // Immutable: the object the caller already held is untouched.
    expect(session.name).toBeNull()
  })

  test('the name survives a round trip through the database', () => {
    const session = create()

    store.setName(session.id, 'Pool leak on 504')

    expect(store.findById(session.id)?.name).toBe('Pool leak on 504')
    expect(store.listByAgent('debugging')[0]?.name).toBe('Pool leak on 504')
    expect(store.listAll()['debugging']?.[0]?.name).toBe('Pool leak on 504')
  })

  test('a name is normalized on the way in, not trusted from the caller', () => {
    const session = create()

    // The renderer validates too, but the boundary that writes is this one.
    expect(store.setName(session.id, '  Pool  leak  ').name).toBe('Pool leak')
  })

  test('a blank name clears it rather than storing whitespace', () => {
    const session = create()
    store.setName(session.id, 'Pool leak')

    expect(store.setName(session.id, '   ').name).toBeNull()
    expect(store.setName(session.id, null).name).toBeNull()
  })

  test('a session can be named as it is created', () => {
    const named = store.create({
      agentId: 'debugging',
      title: 'New session',
      origin: 'you',
      name: '  Pool leak  ',
    })

    expect(named.name).toBe('Pool leak')
    expect(store.findById(named.id)?.name).toBe('Pool leak')
  })

  test('refuses to name a session that is not there', () => {
    // Silently succeeding would leave the renderer showing a name nothing
    // holds, which survives until the next reload.
    expect(() => store.setName('gone', 'Pool leak')).toThrow(/gone/)
  })
})
