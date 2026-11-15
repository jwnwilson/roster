import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { Sidebar } from '@/components/Sidebar'
import { ALL_PROJECTS, useRoster } from '@/state/store'
import { anAgent, aProject, aSession, aTask } from './factories'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()

const DEBUGGING = anAgent({ id: 'debugging', name: 'Debugging Agent' })
const REVIEW = anAgent({ id: 'review', name: 'Review Agent' })

const TASKS = [
  aTask({ id: 'ROS-6', title: 'Fix connection pool leak on 504' }),
  aTask({ id: 'ROS-7', title: 'Style pass on api handlers' }),
  aTask({ id: 'ROS-9', title: 'Review PR 482', projectId: 'proj-b' }),
]

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  installRosterApi()
})

function setSessions(sessions: Record<string, ReturnType<typeof aSession>[]>, extra = {}): void {
  useRoster.setState({
    agents: [DEBUGGING, REVIEW],
    tasks: TASKS,
    sessions,
    loaded: true,
    ...extra,
  })
}

function section(): HTMLElement {
  return screen.getByRole('region', { name: 'Linked tasks' })
}

describe('Sidebar — linked tasks', () => {
  test('lists only the tasks that have a session working on them', () => {
    setSessions({
      debugging: [aSession({ id: 's1', agentId: 'debugging', taskId: 'ROS-6', title: 'Pool trace' })],
      review: [aSession({ id: 's2', agentId: 'review', title: 'Ad hoc chat' })],
    })

    render(<Sidebar />)

    const rail = within(section())
    expect(rail.getByRole('button', { name: /ROS-6/ })).toBeInTheDocument()
    expect(rail.queryByRole('button', { name: /ROS-7/ })).not.toBeInTheDocument()
    expect(rail.queryByRole('button', { name: /ROS-9/ })).not.toBeInTheDocument()
  })

  test('shows the sessions working on a task once it is expanded, and opens one', async () => {
    const user = userEvent.setup()
    setSessions({
      debugging: [aSession({ id: 's1', agentId: 'debugging', taskId: 'ROS-6', title: 'Pool trace' })],
      review: [
        aSession({
          id: 's2',
          agentId: 'review',
          origin: 'agent',
          spawnedFrom: { agentId: 'debugging', sessionId: 's1', label: 'from' },
          title: 'Review the pool fix',
        }),
      ],
    })

    render(<Sidebar />)
    await user.click(within(section()).getByRole('button', { name: 'Expand Fix connection pool leak on 504' }))

    await user.click(within(section()).getByRole('button', { name: /Review the pool fix/ }))

    expect(useRoster.getState().screen).toBe('agent')
    expect(useRoster.getState().agentId).toBe('review')
    expect(useRoster.getState().sess.review).toBe('s2')
  })

  test('opens the task itself from its row', async () => {
    const user = userEvent.setup()
    setSessions({
      debugging: [aSession({ id: 's1', agentId: 'debugging', taskId: 'ROS-6' })],
    })

    render(<Sidebar />)
    await user.click(within(section()).getByRole('button', { name: /ROS-6/ }))

    expect(useRoster.getState().openTaskId).toBe('ROS-6')
    // The modal lives on the Tasks screen, so opening a task from an agent's
    // screen has to go there, or the click would do nothing visible.
    expect(useRoster.getState().screen).toBe('tasks')
  })

  test('unfolds the task of the session you are in, and marks that session', () => {
    setSessions({
      debugging: [aSession({ id: 's1', agentId: 'debugging', taskId: 'ROS-6', title: 'Pool trace' })],
    })
    useRoster.setState({ screen: 'agent', agentId: 'debugging', sess: { debugging: 's1' } })

    render(<Sidebar />)

    const current = within(section()).getByRole('button', { name: /Pool trace/ })
    expect(current).toHaveAttribute('aria-current', 'true')
  })

  test('follows the project filter, dropping tasks with no session in that project', () => {
    setSessions(
      {
        debugging: [
          aSession({ id: 's1', agentId: 'debugging', taskId: 'ROS-6', projectId: 'proj-a' }),
          aSession({ id: 's3', agentId: 'debugging', taskId: 'ROS-9', projectId: 'proj-b' }),
        ],
      },
      { projects: [aProject({ id: 'proj-a' }), aProject({ id: 'proj-b' })], projectFilter: 'proj-a' },
    )

    render(<Sidebar />)

    expect(within(section()).getByRole('button', { name: /ROS-6/ })).toBeInTheDocument()
    expect(within(section()).queryByRole('button', { name: /ROS-9/ })).not.toBeInTheDocument()
  })

  test('shows every linked task again when the filter is cleared', () => {
    setSessions(
      {
        debugging: [
          aSession({ id: 's1', agentId: 'debugging', taskId: 'ROS-6', projectId: 'proj-a' }),
          aSession({ id: 's3', agentId: 'debugging', taskId: 'ROS-9', projectId: 'proj-b' }),
        ],
      },
      { projects: [aProject({ id: 'proj-a' }), aProject({ id: 'proj-b' })], projectFilter: ALL_PROJECTS },
    )

    render(<Sidebar />)

    expect(within(section()).getByRole('button', { name: /ROS-6/ })).toBeInTheDocument()
    expect(within(section()).getByRole('button', { name: /ROS-9/ })).toBeInTheDocument()
  })

  test('says how many tasks are listed', () => {
    setSessions({
      debugging: [
        aSession({ id: 's1', agentId: 'debugging', taskId: 'ROS-6' }),
        aSession({ id: 's3', agentId: 'debugging', taskId: 'ROS-7' }),
      ],
    })

    render(<Sidebar />)

    expect(within(section()).getByText('2')).toBeInTheDocument()
  })

  test('a search that matches a session keeps its task and narrows the list to it', async () => {
    const user = userEvent.setup()
    setSessions({
      debugging: [
        aSession({ id: 's1', agentId: 'debugging', taskId: 'ROS-6', title: 'Trace the leak' }),
        aSession({ id: 's3', agentId: 'debugging', taskId: 'ROS-6', title: 'Unrelated chat' }),
      ],
    })

    render(<Sidebar />)
    await user.type(screen.getByRole('textbox', { name: 'Search agents and sessions' }), 'trace')

    expect(within(section()).getByRole('button', { name: /ROS-6/ })).toBeInTheDocument()
    expect(within(section()).getByRole('button', { name: /Trace the leak/ })).toBeInTheDocument()
    expect(within(section()).queryByRole('button', { name: /Unrelated chat/ })).not.toBeInTheDocument()
  })

  test('shows no section at all when nothing is linked', () => {
    setSessions({ debugging: [aSession({ id: 's1', agentId: 'debugging' })] })

    render(<Sidebar />)

    expect(screen.queryByRole('region', { name: 'Linked tasks' })).not.toBeInTheDocument()
  })
})
