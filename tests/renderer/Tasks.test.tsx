import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { Tasks } from '@/screens/Tasks'
import { ALL_PROJECTS, useRoster } from '@/state/store'
import { anAgent, aProject, aTask } from './factories'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()

const TASKS = [
  aTask({ id: 'ROS-1', title: 'Add concurrent index', status: 'todo' }),
  aTask({ id: 'ROS-2', title: 'Migration dry-run', status: 'in_progress' }),
  aTask({ id: 'ROS-3', title: 'Fix pool leak', status: 'in_review', priority: 'urgent' }),
  aTask({ id: 'ROS-4', title: 'Review PR #482', status: 'done' }),
]

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  useRoster.setState({ tasks: TASKS, loaded: true })
  installRosterApi()
})

function column(name: string): HTMLElement {
  return screen.getByRole('region', { name })
}

describe('Tasks — the board', () => {
  test('gives every column in the design a heading', () => {
    render(<Tasks />)

    for (const label of ['To Do', 'In Progress', 'In Review', 'Done']) {
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
    }
  })

  test('files each task under its own status', () => {
    render(<Tasks />)

    expect(within(column('To Do')).getByText('Add concurrent index')).toBeInTheDocument()
    expect(within(column('In Review')).getByText('Fix pool leak')).toBeInTheDocument()
    expect(within(column('Done')).getByText('Review PR #482')).toBeInTheDocument()
  })

  test('counts what each column holds', () => {
    useRoster.setState({
      tasks: [aTask({ id: 'a', status: 'todo' }), aTask({ id: 'b', status: 'todo' })],
    })
    render(<Tasks />)

    expect(within(column('To Do')).getByText('2')).toBeInTheDocument()
  })

  test('summarises the board in the handoff wording', () => {
    render(<Tasks />)
    expect(screen.getByText('4 tasks · 1 in review')).toBeInTheDocument()
  })

  test('says "task" rather than "tasks" when there is one', () => {
    useRoster.setState({ tasks: [aTask()] })
    render(<Tasks />)

    expect(screen.getByText('1 task · 0 in review')).toBeInTheDocument()
  })

  test('shows the key and the labels on a card', () => {
    useRoster.setState({ tasks: [aTask({ id: 'ROS-7', labels: ['bug', 'api'] })] })
    render(<Tasks />)

    expect(screen.getByText('ROS-7')).toBeInTheDocument()
    expect(screen.getByText('bug')).toBeInTheDocument()
    expect(screen.getByText('api')).toBeInTheDocument()
  })

  test('names the assignee on the card, and marks an unassigned one', () => {
    useRoster.setState({
      agents: [anAgent({ id: 'debugging', name: 'Debugging Agent' })],
      tasks: [
        aTask({ id: 'ROS-1', assigneeId: 'debugging' }),
        aTask({ id: 'ROS-2', assigneeId: null }),
      ],
    })
    render(<Tasks />)

    expect(screen.getByTitle('Debugging Agent')).toBeInTheDocument()
    expect(screen.getByTitle('Unassigned')).toBeInTheDocument()
  })

  test('shows a comment count only once there are comments', () => {
    useRoster.setState({
      tasks: [aTask({ id: 'ROS-1' })],
      taskComments: {
        'ROS-1': [
          { id: 'c1', taskId: 'ROS-1', author: 'you', tone: 'you', text: 'a', isSystem: false, createdAt: 1 },
        ],
      },
    })
    render(<Tasks />)

    expect(screen.getByText('1 comment')).toBeInTheDocument()
  })

  test('does not count History entries as comments', () => {
    // The card should say what people said, not how many times it moved.
    useRoster.setState({
      tasks: [aTask({ id: 'ROS-1' })],
      taskComments: {
        'ROS-1': [
          { id: 'h1', taskId: 'ROS-1', author: 'You', tone: 'you', text: 'moved', isSystem: true, createdAt: 1 },
        ],
      },
    })
    render(<Tasks />)

    expect(screen.queryByText(/comment/)).not.toBeInTheDocument()
  })
})

describe('Tasks — filtering', () => {
  test('filters by title as the user types', async () => {
    const user = userEvent.setup()
    render(<Tasks />)

    await user.type(screen.getByLabelText('Filter tasks'), 'leak')

    expect(screen.getByText('Fix pool leak')).toBeInTheDocument()
    expect(screen.queryByText('Migration dry-run')).not.toBeInTheDocument()
  })

  test('matches on the task key, which is how people refer to one', async () => {
    const user = userEvent.setup()
    render(<Tasks />)

    await user.type(screen.getByLabelText('Filter tasks'), 'ROS-2')

    expect(screen.getByText('Migration dry-run')).toBeInTheDocument()
    expect(screen.queryByText('Fix pool leak')).not.toBeInTheDocument()
  })

  test('switches the summary to a match count while filtering', async () => {
    const user = userEvent.setup()
    render(<Tasks />)

    await user.type(screen.getByLabelText('Filter tasks'), 'leak')

    expect(screen.getByText('1 of 4 match')).toBeInTheDocument()
  })

  test('narrows the board to one project', async () => {
    const user = userEvent.setup()
    useRoster.setState({
      projects: [aProject({ id: 'p1', name: 'API reliability' })],
      tasks: [
        aTask({ id: 'ROS-1', title: 'In the project', projectId: 'p1' }),
        aTask({ id: 'ROS-2', title: 'Not in it', projectId: null }),
      ],
    })
    render(<Tasks />)

    await user.selectOptions(screen.getByLabelText('Filter by project'), 'p1')

    expect(screen.getByText('In the project')).toBeInTheDocument()
    expect(screen.queryByText('Not in it')).not.toBeInTheDocument()
  })

  test('offers every project plus an all-projects option', () => {
    useRoster.setState({ projects: [aProject({ id: 'p1', name: 'API reliability' })] })
    render(<Tasks />)

    const select = screen.getByLabelText('Filter by project')
    expect(within(select).getByText('All projects')).toBeInTheDocument()
    expect(within(select).getByText('API reliability')).toBeInTheDocument()
  })
})

describe('Tasks — opening things', () => {
  test('clicking a card opens its detail', async () => {
    const user = userEvent.setup()
    render(<Tasks />)

    await user.click(screen.getByText('Fix pool leak'))

    expect(useRoster.getState().openTaskId).toBe('ROS-3')
  })

  test('a task opens on Comments, not on its History', async () => {
    const user = userEvent.setup()
    useRoster.setState({ taskTab: 'history' })
    render(<Tasks />)

    await user.click(screen.getByText('Fix pool leak'))

    expect(useRoster.getState().taskTab).toBe('comments')
  })

  test('the New task button opens the create modal', async () => {
    const user = userEvent.setup()
    render(<Tasks />)

    await user.click(screen.getByRole('button', { name: 'New task' }))

    expect(useRoster.getState().newTaskOpen).toBe(true)
  })

  test('the Projects button opens the projects modal', async () => {
    const user = userEvent.setup()
    render(<Tasks />)

    await user.click(screen.getByRole('button', { name: 'Projects' }))

    expect(useRoster.getState().projectsOpen).toBe(true)
  })
})

describe('Tasks — moving a card by keyboard', () => {
  test('Enter opens the task rather than lifting it', async () => {
    const user = userEvent.setup()
    render(<Tasks />)

    const card = screen.getByRole('button', { name: 'ROS-3: Fix pool leak' })
    card.focus()
    await user.keyboard('{Enter}')

    expect(useRoster.getState().openTaskId).toBe('ROS-3')
  })

  test('Space lifts a card without opening it', async () => {
    const user = userEvent.setup()
    render(<Tasks />)

    const card = screen.getByRole('button', { name: 'ROS-3: Fix pool leak' })
    card.focus()
    await user.keyboard(' ')

    // The two keys must not both do the same thing, or a keyboard user can
    // never drag.
    expect(useRoster.getState().openTaskId).toBeNull()
  })

  test('every card is reachable by keyboard', () => {
    render(<Tasks />)

    for (const task of TASKS) {
      const card = screen.getByRole('button', { name: `${task.id}: ${task.title}` })
      expect(card.tabIndex).toBe(0)
    }
  })
})

describe('Tasks — an empty board', () => {
  test('renders every column even with nothing on it', () => {
    useRoster.setState({ tasks: [] })
    render(<Tasks />)

    expect(screen.getByRole('heading', { name: 'To Do' })).toBeInTheDocument()
    expect(screen.getByText('0 tasks · 0 in review')).toBeInTheDocument()
  })

  test('starts with no project filter applied', () => {
    render(<Tasks />)
    expect(useRoster.getState().projectFilter).toBe(ALL_PROJECTS)
  })
})
