import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { NotionInspection } from '@shared/notion'
import { NotionModal } from '@/screens/NotionModal'
import { useRoster } from '@/state/store'
import { aProject } from './factories'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()

const FOUND: NotionInspection = {
  databaseId: 'db-1',
  dataSourceId: 'ds-1',
  name: 'Engineering tasks',
  properties: [
    { name: 'Name', type: 'title', options: [] },
    { name: 'Status', type: 'status', options: ['To Do', 'Done'] },
    { name: 'Urgency', type: 'select', options: ['High'] },
    { name: 'Owner', type: 'people', options: [] },
  ],
  mapping: {
    title: 'Name',
    status: 'Status',
    priority: null,
    assignee: 'Owner',
    statusValues: { 'To Do': 'todo', Done: 'done' },
    priorityValues: {},
  },
  unmapped: ['in_progress', 'in_review'],
}

const SUMMARY = { created: 4, updated: 1, skipped: 0, failed: [] }

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  useRoster.setState({ projects: [aProject({ id: 'p1', name: 'API reliability' })] })
  installRosterApi()
})

/** Gets as far as the mapping being on screen. */
async function lookUp(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Notion database'), 'https://notion.so/db')
  await user.click(screen.getByRole('button', { name: 'Look up' }))
  await screen.findByLabelText('Status property')
}

describe('connecting', () => {
  beforeEach(() => {
    installRosterApi({
      notion: {
        connections: vi.fn().mockResolvedValue([]),
        inspect: vi.fn().mockResolvedValue(FOUND),
        connect: vi.fn().mockResolvedValue({ id: 'c1', ...FOUND, projectId: null, createdAt: 0 }),
        importNow: vi.fn().mockResolvedValue(SUMMARY),
      },
    })
  })

  test('will not look anything up until something is pasted', () => {
    render(<NotionModal />)

    expect(screen.getByRole('button', { name: 'Look up' })).toBeDisabled()
  })

  test('shows what it found, and what it guessed each field was', async () => {
    const user = userEvent.setup()
    render(<NotionModal />)

    await lookUp(user)

    expect(window.roster.notion.inspect).toHaveBeenCalledWith('https://notion.so/db')
    expect(screen.getByLabelText('Title property')).toHaveValue('Name')
    expect(screen.getByLabelText('Status property')).toHaveValue('Status')
    expect(screen.getByLabelText('Assignee property')).toHaveValue('Owner')
  })

  test('a field it could not find reads as not mapped, rather than as a wrong guess', async () => {
    const user = userEvent.setup()
    render(<NotionModal />)

    await lookUp(user)

    expect(screen.getByLabelText('Priority property')).toHaveValue('none')
  })

  test('offers only properties of a type that could play the part', async () => {
    const user = userEvent.setup()
    render(<NotionModal />)
    await lookUp(user)

    const options = Array.from(
      screen.getByLabelText('Assignee property').querySelectorAll('option'),
    ).map((option) => option.textContent)

    // A people or a select could be an assignee; a title could not. The order
    // is the database's own, so the list reads as Notion lays it out.
    expect(options).toEqual(['Not mapped', 'Urgency (select)', 'Owner (people)'])
  })

  test('says which board columns nothing will import into', async () => {
    const user = userEvent.setup()
    render(<NotionModal />)

    await lookUp(user)

    // Worth knowing before importing three hundred rows, not after.
    expect(screen.getByText(/Nothing in Notion maps onto/)).toHaveTextContent(
      'In Progress, In Review',
    )
  })

  test('warns when there is no title, since every page would be skipped', async () => {
    installRosterApi({
      notion: {
        connections: vi.fn().mockResolvedValue([]),
        inspect: vi.fn().mockResolvedValue({ ...FOUND, mapping: { ...FOUND.mapping, title: null } }),
      },
    })
    const user = userEvent.setup()
    render(<NotionModal />)

    await user.type(screen.getByLabelText('Notion database'), 'db')
    await user.click(screen.getByRole('button', { name: 'Look up' }))

    expect(await screen.findByText(/nothing to put on a card/)).toBeInTheDocument()
  })

  test('a correction is what gets saved, not the guess', async () => {
    const user = userEvent.setup()
    render(<NotionModal />)
    await lookUp(user)

    await user.selectOptions(screen.getByLabelText('Priority property'), 'Urgency')
    await user.selectOptions(screen.getByLabelText('Import into'), 'p1')
    await user.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() =>
      expect(window.roster.notion.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          dataSourceId: 'ds-1',
          projectId: 'p1',
          mapping: expect.objectContaining({ priority: 'Urgency' }),
        }),
      ),
    )
  })

  test('imports straight after connecting, and says what it did', async () => {
    const user = userEvent.setup()
    render(<NotionModal />)
    await lookUp(user)

    await user.click(screen.getByRole('button', { name: 'Import' }))

    expect(await screen.findByText('4 created · 1 updated.')).toBeInTheDocument()
    expect(window.roster.notion.importNow).toHaveBeenCalledWith('c1')
  })

  test('refreshes the board, which is stale the moment an import lands', async () => {
    const user = userEvent.setup()
    render(<NotionModal />)
    await lookUp(user)

    await user.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() => expect(window.roster.tasks.list).toHaveBeenCalled())
  })
})

describe('when Notion says no', () => {
  test('shows what it said, rather than failing quietly', async () => {
    installRosterApi({
      notion: {
        connections: vi.fn().mockResolvedValue([]),
        inspect: vi
          .fn()
          .mockRejectedValue(new Error('Notion cannot see that database. Open it in Notion…')),
      },
    })
    const user = userEvent.setup()
    render(<NotionModal />)

    await user.type(screen.getByLabelText('Notion database'), 'db')
    await user.click(screen.getByRole('button', { name: 'Look up' }))

    expect(await screen.findByText(/cannot see that database/)).toBeInTheDocument()
  })

  test('a failed import is reported per row rather than swallowed', async () => {
    installRosterApi({
      notion: {
        connections: vi.fn().mockResolvedValue([]),
        inspect: vi.fn().mockResolvedValue(FOUND),
        connect: vi.fn().mockResolvedValue({ id: 'c1', ...FOUND, projectId: null, createdAt: 0 }),
        importNow: vi
          .fn()
          .mockResolvedValue({ created: 1, updated: 0, skipped: 1, failed: ['Fix it: nope'] }),
      },
    })
    const user = userEvent.setup()
    render(<NotionModal />)
    await lookUp(user)

    await user.click(screen.getByRole('button', { name: 'Import' }))

    expect(await screen.findByText('1 created · 0 updated · 1 skipped.')).toBeInTheDocument()
    expect(screen.getByText('Fix it: nope')).toBeInTheDocument()
  })
})

describe('once connected', () => {
  beforeEach(() => {
    installRosterApi({
      notion: {
        connections: vi.fn().mockResolvedValue([
          {
            id: 'c1',
            name: 'Engineering tasks',
            databaseId: 'db-1',
            dataSourceId: 'ds-1',
            mapping: FOUND.mapping,
            projectId: null,
            createdAt: 0,
          },
        ]),
        importNow: vi.fn().mockResolvedValue(SUMMARY),
        disconnect: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  test('names the database rather than asking for it again', async () => {
    render(<NotionModal />)

    expect(await screen.findByText('Engineering tasks')).toBeInTheDocument()
    expect(screen.queryByLabelText('Notion database')).not.toBeInTheDocument()
  })

  test('pulling again is a button, since nothing polls', async () => {
    const user = userEvent.setup()
    render(<NotionModal />)

    await user.click(await screen.findByRole('button', { name: 'Import now' }))

    expect(window.roster.notion.importNow).toHaveBeenCalledWith('c1')
    expect(await screen.findByText('4 created · 1 updated.')).toBeInTheDocument()
  })

  test('disconnecting asks the main process to forget it', async () => {
    const user = userEvent.setup()
    render(<NotionModal />)

    await user.click(await screen.findByRole('button', { name: 'Disconnect' }))

    expect(window.roster.notion.disconnect).toHaveBeenCalledWith('c1')
  })
})
