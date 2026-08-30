import { describe, expect, test } from 'vitest'
import {
  EMPTY_MAPPING,
  detectMapping,
  toPriority,
  toProperties,
  toStatus,
  toTask,
  unmappedStatuses,
  type NotionMapping,
  type NotionProperty,
} from '@main/notion/mapping'

/** A schema shaped like a Notion task database people actually make. */
const SCHEMA: NotionProperty[] = [
  { name: 'Name', type: 'title', options: [] },
  { name: 'Status', type: 'status', options: ['Backlog', 'To Do', 'In progress', 'In review', 'Done'] },
  { name: 'Priority', type: 'select', options: ['Urgent', 'High', 'Medium', 'Low'] },
  { name: 'Owner', type: 'people', options: [] },
  { name: 'Notes', type: 'rich_text', options: [] },
]

const title = (text: string) => ({ title: [{ plain_text: text }] })

describe('detectMapping', () => {
  test('finds each field in an ordinary task database', () => {
    const mapping = detectMapping(SCHEMA)

    expect(mapping.title).toBe('Name')
    expect(mapping.status).toBe('Status')
    expect(mapping.priority).toBe('Priority')
    expect(mapping.assignee).toBe('Owner')
  })

  test('takes the title from the type, whatever the property is called', () => {
    const mapping = detectMapping([{ name: 'Task', type: 'title', options: [] }])

    // Exactly one property in any Notion database has type title, so the type
    // settles it and the name never has to.
    expect(mapping.title).toBe('Task')
  })

  test('falls back to a select named like a status when there is no status type', () => {
    const mapping = detectMapping([
      { name: 'Name', type: 'title', options: [] },
      { name: 'Stage', type: 'select', options: ['To Do', 'Done'] },
    ])

    expect(mapping.status).toBe('Stage')
  })

  test('prefers a real status property over a select that merely sounds like one', () => {
    const mapping = detectMapping([
      { name: 'Workflow state', type: 'select', options: ['To Do'] },
      { name: 'Status', type: 'status', options: ['Done'] },
    ])

    expect(mapping.status).toBe('Status')
  })

  test('finds nothing rather than guessing when a database has none of it', () => {
    const mapping = detectMapping([{ name: 'Notes', type: 'rich_text', options: [] }])

    expect(mapping).toEqual(EMPTY_MAPPING)
  })

  test('is not defeated by an empty schema', () => {
    expect(detectMapping([])).toEqual(EMPTY_MAPPING)
  })
})

describe('folding Notion option names onto ours', () => {
  test('reads the five columns however they are punctuated or cased', () => {
    const { statusValues } = detectMapping(SCHEMA)

    expect(statusValues).toEqual({
      Backlog: 'backlog',
      'To Do': 'todo',
      'In progress': 'in_progress',
      'In review': 'in_review',
      Done: 'done',
    })
  })

  test('matches on letters alone, so spacing and case do not matter', () => {
    const mapping = detectMapping([
      { name: 'Status', type: 'status', options: ['IN-PROGRESS', 'in progress', 'InProgress'] },
    ])

    expect(Object.values(mapping.statusValues)).toEqual([
      'in_progress',
      'in_progress',
      'in_progress',
    ])
  })

  test('knows the words other boards use for the same columns', () => {
    const mapping = detectMapping([
      { name: 'Status', type: 'status', options: ['Icebox', 'Not started', 'Doing', 'Shipped'] },
    ])

    expect(mapping.statusValues).toEqual({
      Icebox: 'backlog',
      'Not started': 'todo',
      Doing: 'in_progress',
      Shipped: 'done',
    })
  })

  test('leaves an option it does not recognise unmapped rather than inventing one', () => {
    const mapping = detectMapping([
      { name: 'Status', type: 'status', options: ['Done', 'Awaiting legal'] },
    ])

    expect(mapping.statusValues).toEqual({ Done: 'done' })
  })

  test('reads priorities, including the P0 shorthand', () => {
    const mapping = detectMapping([
      { name: 'Priority', type: 'select', options: ['P0', 'P1', 'Normal', 'P3'] },
    ])

    expect(mapping.priorityValues).toEqual({
      P0: 'urgent',
      P1: 'high',
      Normal: 'medium',
      P3: 'low',
    })
  })

  test('says which columns nothing imports into', () => {
    const mapping = detectMapping([
      { name: 'Status', type: 'status', options: ['To Do', 'Done'] },
    ])

    // Worth surfacing: a board where nothing can ever be In Review is
    // usually a mapping someone needs to correct.
    expect(unmappedStatuses(mapping)).toEqual(['in_progress', 'in_review'])
  })
})

describe('toTask', () => {
  const mapping = detectMapping(SCHEMA)

  test('reads a page into a task', () => {
    const page = {
      id: 'page-1',
      properties: {
        Name: title('Fix the pool leak'),
        Status: { status: { name: 'In progress' } },
        Priority: { select: { name: 'High' } },
        Owner: { people: [{ name: 'Debugging Agent' }] },
      },
    }

    expect(toTask(page, mapping)).toEqual({
      pageId: 'page-1',
      title: 'Fix the pool leak',
      status: 'in_progress',
      priority: 'high',
      assigneeName: 'Debugging Agent',
    })
  })

  test('joins a title split across rich-text parts', () => {
    const page = {
      id: 'p',
      properties: { Name: { title: [{ plain_text: 'Fix ' }, { plain_text: 'the leak' }] } },
    }

    expect(toTask(page, mapping)?.title).toBe('Fix the leak')
  })

  test('refuses a page with no title, since that is a card with nothing on it', () => {
    expect(toTask({ id: 'p', properties: { Name: { title: [] } } }, mapping)).toBeNull()
    expect(toTask({ id: 'p', properties: {} }, mapping)).toBeNull()
  })

  test('takes the first person, because Roster has one assignee and Notion allows several', () => {
    const page = {
      id: 'p',
      properties: {
        Name: title('x'),
        Owner: { people: [{ name: 'Review Agent' }, { name: 'Someone else' }] },
      },
    }

    expect(toTask(page, mapping)?.assigneeName).toBe('Review Agent')
  })

  test('an unassigned page has no assignee rather than a wrong one', () => {
    const page = { id: 'p', properties: { Name: title('x'), Owner: { people: [] } } }

    expect(toTask(page, mapping)?.assigneeName).toBeNull()
  })
})

describe('what an unrecognised state becomes', () => {
  const mapping = detectMapping(SCHEMA)

  test('a column nothing mapped lands in the backlog, not in To Do', () => {
    // It is not "ready to start" — it is work whose state Roster does not
    // understand, which is exactly what the backlog is for.
    expect(toStatus('Awaiting legal', mapping)).toBe('backlog')
  })

  test('so does a page with no status at all', () => {
    expect(toStatus(null, mapping)).toBe('backlog')
  })

  test('an unrecognised priority is medium, matching a hand-made task', () => {
    expect(toPriority('Spicy', mapping)).toBe('medium')
    expect(toPriority(null, mapping)).toBe('medium')
  })
})

describe('toProperties', () => {
  const mapping = detectMapping(SCHEMA)

  test('writes back the status and priority Notion knows about', () => {
    const body = toProperties({ status: 'in_review', priority: 'urgent' }, mapping, null)

    expect(body).toEqual({
      Status: { status: { name: 'In review' } },
      Priority: { select: { name: 'Urgent' } },
    })
  })

  test('never writes the title or the description', () => {
    const body = toProperties({ status: 'done', priority: 'low' }, mapping, null)

    // Notion stays authoritative for the words, so an agent rewriting a
    // description cannot overwrite what someone wrote there.
    expect(Object.keys(body)).toEqual(['Status', 'Priority'])
  })

  test('omits a status the database has no option for, rather than sending a 400', () => {
    const narrow: NotionMapping = {
      ...mapping,
      statusValues: { Done: 'done' },
    }

    expect(toProperties({ status: 'in_review', priority: 'low' }, narrow, null)).toEqual({
      Priority: { select: { name: 'Low' } },
    })
  })

  test('writes the assignee only when the agent resolves to a Notion person', () => {
    expect(toProperties({ status: 'done', priority: 'low' }, mapping, 'user-1')).toMatchObject({
      Owner: { people: [{ id: 'user-1' }] },
    })

    // Otherwise leave it alone — clearing someone's assignment is worse than
    // not writing it.
    expect(toProperties({ status: 'done', priority: 'low' }, mapping, null)).not.toHaveProperty(
      'Owner',
    )
  })

  test('writes nothing at all when nothing is mapped', () => {
    expect(toProperties({ status: 'done', priority: 'low' }, EMPTY_MAPPING, 'user-1')).toEqual({})
  })
})
