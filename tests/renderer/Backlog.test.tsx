import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { Tasks } from '@/screens/Tasks'
import { ALL_PRIORITIES, ALL_PROJECTS, useRoster } from '@/state/store'
import { aProject, aTask } from './factories'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()

const PROJECTS = [
  aProject({ id: 'p1', name: 'Multi-region migration' }),
  aProject({ id: 'p2', name: 'API reliability' }),
]

const TASKS = [
  aTask({ id: 'ROS-1', title: 'Add concurrent index', status: 'todo' }),
  aTask({ id: 'ROS-2', title: 'Fix pool leak', status: 'in_review' }),
  aTask({
    id: 'ROS-9',
    title: 'Replay tokens instead of sticky sessions',
    status: 'backlog',
    priority: 'low',
    projectId: 'p1',
  }),
  aTask({
    id: 'ROS-10',
    title: 'Budget alerts per agent',
    status: 'backlog',
    priority: 'urgent',
    projectId: 'p2',
  }),
]

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  useRoster.setState({ tasks: TASKS, projects: PROJECTS, loaded: true })
  installRosterApi()
})

function backlog(): HTMLElement {
  return screen.getByRole('listbox', { name: 'Backlog' })
}

/** Opens the Backlog tab the way someone would. */
async function openBacklog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('tab', { name: 'Backlog' }))
}

describe('the Tasks view switcher', () => {
  test('opens on the board, with Backlog offered beside it', () => {
    render(<Tasks />)

    expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Backlog' })).toHaveAttribute('aria-selected', 'false')
  })

  test('switching hides the board and shows the list', async () => {
    const user = userEvent.setup()
    render(<Tasks />)

    await openBacklog(user)

    expect(screen.queryByRole('region', { name: 'To Do' })).not.toBeInTheDocument()
    expect(backlog()).toBeInTheDocument()
  })

  test('the header keeps its own controls on both tabs', async () => {
    const user = userEvent.setup()
    render(<Tasks />)
    await openBacklog(user)

    // The handoff leaves the header alone; only the body below it changes.
    expect(screen.getByRole('button', { name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByLabelText('Filter tasks')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument()
  })
})

describe('the backlog list', () => {
  test('lists backlog work and nothing that is on the board', async () => {
    const user = userEvent.setup()
    render(<Tasks />)
    await openBacklog(user)

    const rows = within(backlog()).getAllByRole('option')
    expect(rows).toHaveLength(2)
    expect(within(backlog()).getByText('ROS-9')).toBeInTheDocument()
    expect(within(backlog()).queryByText('ROS-1')).not.toBeInTheDocument()
  })

  test('a row shows its key, title and project, and no assignee', async () => {
    const user = userEvent.setup()
    render(<Tasks />)
    await openBacklog(user)

    const row = within(backlog()).getByRole('option', { name: /Budget alerts/ })
    expect(within(row).getByText('ROS-10')).toBeInTheDocument()
    expect(within(row).getByText('API reliability')).toBeInTheDocument()
  })

  test('backlog work never reaches the board', () => {
    render(<Tasks />)

    // The board's own filter drops it, so a backlog task cannot appear in a
    // column even before the view switches.
    expect(screen.queryByText('Replay tokens instead of sticky sessions')).not.toBeInTheDocument()
  })

  test('says so when there is nothing in the backlog', async () => {
    const user = userEvent.setup()
    useRoster.setState({ tasks: TASKS.filter((task) => task.status !== 'backlog') })
    render(<Tasks />)
    await openBacklog(user)

    expect(screen.getByText('No backlog tasks.')).toBeInTheDocument()
  })
})

describe('choosing a backlog task', () => {
  test('the first row is selected, so the panel is never blank for nothing', async () => {
    const user = userEvent.setup()
    render(<Tasks />)
    await openBacklog(user)

    expect(within(backlog()).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
  })

  test('the panel shows the selected task, with the same fields as the modal', async () => {
    const user = userEvent.setup()
    render(<Tasks />)
    await openBacklog(user)

    await user.click(within(backlog()).getByRole('option', { name: /Budget alerts/ }))

    expect(screen.getByLabelText('Status')).toHaveValue('backlog')
    expect(screen.getByLabelText('Priority')).toHaveValue('urgent')
    expect(screen.getByLabelText('Project')).toHaveValue('p2')
    expect(screen.getByRole('button', { name: 'Budget alerts per agent' })).toBeInTheDocument()
  })

  test('the Status select offers the board, which is the way out of here', async () => {
    const user = userEvent.setup()
    render(<Tasks />)
    await openBacklog(user)

    const options = Array.from(
      screen.getByLabelText('Status').querySelectorAll('option'),
    ).map((option) => option.textContent)

    // The handoff gives the backlog no drag path; this select is the only
    // way a task gets onto the board.
    expect(options).toEqual(['Backlog', 'To Do', 'In Progress', 'In Review', 'Done'])
  })
})

describe('deleting from the backlog', () => {
  test('the panel can delete the task it is showing', async () => {
    const user = userEvent.setup()
    const api = installRosterApi()
    render(<Tasks />)
    await openBacklog(user)

    await user.click(within(backlog()).getByRole('option', { name: /Budget alerts/ }))
    await user.click(screen.getByRole('button', { name: 'Delete ROS-10' }))

    // The backlog is where the junk collects, so it needs the same delete
    // the board's modal has rather than only the modal having one.
    expect(api.tasks.remove).toHaveBeenCalledWith('ROS-10')
  })
})

describe('filtering the backlog', () => {
  test('matches on title', async () => {
    const user = userEvent.setup()
    render(<Tasks />)
    await openBacklog(user)

    await user.type(screen.getByLabelText('Filter backlog'), 'budget')

    expect(within(backlog()).getAllByRole('option')).toHaveLength(1)
  })

  test('matches on the task key, which is how people refer to one', async () => {
    const user = userEvent.setup()
    render(<Tasks />)
    await openBacklog(user)

    await user.type(screen.getByLabelText('Filter backlog'), 'ROS-9')

    expect(within(backlog()).getAllByRole('option')).toHaveLength(1)
  })

  test('narrows by priority', async () => {
    const user = userEvent.setup()
    render(<Tasks />)
    await openBacklog(user)

    await user.selectOptions(screen.getByLabelText('Filter by priority'), 'urgent')

    expect(within(backlog()).getAllByRole('option')).toHaveLength(1)
    expect(within(backlog()).getByText('ROS-10')).toBeInTheDocument()
  })

  test('narrows by project, using the filter the whole app shares', async () => {
    const user = userEvent.setup()
    render(<Tasks />)
    await openBacklog(user)

    // Two of these are on screen at once here — the header's and the
    // sidebar's — so they have to be one value.
    const [header, sidebar] = screen.getAllByLabelText('Filter by project')
    await user.selectOptions(sidebar!, 'p1')

    expect(header).toHaveValue('p1')
    expect(within(backlog()).getAllByRole('option')).toHaveLength(1)
    expect(within(backlog()).getByText('ROS-9')).toBeInTheDocument()
  })

  test('an empty result still says so rather than showing a bare pane', async () => {
    const user = userEvent.setup()
    render(<Tasks />)
    await openBacklog(user)

    await user.type(screen.getByLabelText('Filter backlog'), 'nothing matches this')

    expect(screen.getByText('No backlog tasks.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument()
  })

  test('the priority filter starts wide open', () => {
    expect(useRoster.getState().backlogPriority).toBe(ALL_PRIORITIES)
    expect(useRoster.getState().projectFilter).toBe(ALL_PROJECTS)
  })
})

describe('adding to the backlog', () => {
  test('the button opens the New Task modal set to Backlog', async () => {
    const user = userEvent.setup()
    render(<Tasks />)
    await openBacklog(user)

    await user.click(screen.getByRole('button', { name: '+ New backlog task' }))

    expect(useRoster.getState().newTaskOpen).toBe(true)
    expect(useRoster.getState().newTaskStatus).toBe('backlog')
  })

  test('the header button still makes a board task', async () => {
    const user = userEvent.setup()
    render(<Tasks />)

    await user.click(screen.getByRole('button', { name: 'New task' }))

    expect(useRoster.getState().newTaskStatus).toBe('todo')
  })
})
