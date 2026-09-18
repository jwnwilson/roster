import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NotionModal } from '@/screens/NotionModal'
import { useRoster } from '@/state/store'
import { aProject, aTask } from './factories'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()
const PAGE_URL = 'https://www.notion.so/Ship-it-1f8d872b594c80a4b2f400370af2b13f'

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  useRoster.setState({ projects: [aProject({ id: 'p1', name: 'API reliability' })] })
  installRosterApi()
})

describe('connecting', () => {
  test('offers the browser sign-in until Notion answers', async () => {
    const authStatus = vi
      .fn()
      .mockResolvedValueOnce({ state: 'disconnected' })
      .mockResolvedValue({ state: 'connected', workspaceName: 'Product' })
    installRosterApi({ notion: { authStatus } })
    const user = userEvent.setup()
    render(<NotionModal />)

    await user.click(await screen.findByRole('button', { name: 'Connect Notion' }))

    expect(window.roster.notion.beginAuth).toHaveBeenCalled()
    expect(await screen.findByLabelText('Notion task')).toBeTruthy()
  })

  test('shows what Notion said when sign-in failed', async () => {
    installRosterApi({
      notion: { authStatus: vi.fn().mockResolvedValue({ state: 'error', message: 'Roster was not authorized.' }) },
    })
    render(<NotionModal />)

    expect(await screen.findByText('Roster was not authorized.')).toBeTruthy()
  })
})

describe('importing a Notion task', () => {
  test('sends the pasted link and the chosen project', async () => {
    const importTask = vi.fn().mockResolvedValue({ task: aTask({ id: 'ROS-12' }), created: true })
    installRosterApi({ notion: { importTask } })
    const user = userEvent.setup()
    render(<NotionModal />)

    await user.type(await screen.findByLabelText('Notion task'), PAGE_URL)
    await user.selectOptions(screen.getByLabelText('Import into'), 'p1')
    await user.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() =>
      expect(importTask).toHaveBeenCalledWith({ url: PAGE_URL, projectId: 'p1' }),
    )
    expect(await screen.findByRole('button', { name: 'Added ROS-12' })).toBeTruthy()
  })

  test('says when the page is already on the board', async () => {
    installRosterApi({
      notion: { importTask: vi.fn().mockResolvedValue({ task: aTask({ id: 'ROS-9' }), created: false }) },
    })
    const user = userEvent.setup()
    render(<NotionModal />)

    await user.type(await screen.findByLabelText('Notion task'), PAGE_URL)
    await user.click(screen.getByRole('button', { name: 'Import' }))

    expect(await screen.findByRole('button', { name: 'Already on the board as ROS-9' })).toBeTruthy()
  })

  test('opens the task it imported', async () => {
    installRosterApi({
      notion: { importTask: vi.fn().mockResolvedValue({ task: aTask({ id: 'ROS-12' }), created: true }) },
    })
    const user = userEvent.setup()
    render(<NotionModal />)

    await user.type(await screen.findByLabelText('Notion task'), PAGE_URL)
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await user.click(await screen.findByRole('button', { name: 'Added ROS-12' }))

    expect(useRoster.getState().openTaskId).toBe('ROS-12')
    expect(useRoster.getState().notionOpen).toBe(false)
  })

  test('shows why a link was refused', async () => {
    installRosterApi({
      notion: { importTask: vi.fn().mockRejectedValue(new Error('That does not look like a Notion page link.')) },
    })
    const user = userEvent.setup()
    render(<NotionModal />)

    await user.type(await screen.findByLabelText('Notion task'), 'nonsense')
    await user.click(screen.getByRole('button', { name: 'Import' }))

    expect(await screen.findByText('That does not look like a Notion page link.')).toBeTruthy()
  })

  test('will not import an empty box', async () => {
    render(<NotionModal />)

    expect((await screen.findByRole('button', { name: 'Import' })).hasAttribute('disabled')).toBe(true)
  })
})

describe('the status map', () => {
  test('shows a name for every Roster column', async () => {
    render(<NotionModal />)

    expect((await screen.findByLabelText<HTMLInputElement>('Done in Notion')).value).toBe('Done')
    expect(screen.getByLabelText<HTMLInputElement>('In Progress in Notion').value).toBe('In progress')
    expect(screen.getByLabelText<HTMLInputElement>('Backlog in Notion').value).toBe('Not started')
  })

  test('saves an edited name', async () => {
    const user = userEvent.setup()
    render(<NotionModal />)

    const input = await screen.findByLabelText('In Review in Notion')
    await user.clear(input)
    await user.type(input, 'Needs review')
    await user.click(screen.getByRole('button', { name: 'Save status names' }))

    await waitFor(() =>
      expect(window.roster.notion.saveStatusMap).toHaveBeenCalledWith(
        expect.objectContaining({ in_review: 'Needs review', done: 'Done' }),
      ),
    )
    expect(await screen.findByText('Saved')).toBeTruthy()
  })
})

describe('disconnecting', () => {
  test('forgets the credential and goes back to the sign-in', async () => {
    const authStatus = vi
      .fn()
      .mockResolvedValueOnce({ state: 'connected', workspaceName: 'Product' })
      .mockResolvedValue({ state: 'disconnected' })
    installRosterApi({ notion: { authStatus } })
    const user = userEvent.setup()
    render(<NotionModal />)

    await user.click(await screen.findByRole('button', { name: 'Disconnect Notion' }))

    expect(window.roster.notion.clearAuth).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Connect Notion' })).toBeTruthy()
  })
})
