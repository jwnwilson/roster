import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TaskDetailModal } from '@/screens/TaskDetailModal'
import { useRoster } from '@/state/store'
import { anAgent, aProject, aTask, aTaskComment } from './factories'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()

const TASK = aTask({
  id: 'ROS-101',
  title: 'Fix connection pool leak on 504',
  description: '## Steps\n\n- reproduce\n- patch',
  status: 'in_review',
  priority: 'urgent',
  labels: ['bug'],
})

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  useRoster.setState({
    tasks: [TASK],
    openTaskId: 'ROS-101',
    agents: [anAgent({ id: 'debugging', name: 'Debugging Agent' })],
    projects: [aProject({ id: 'p1', name: 'API reliability' })],
  })
  installRosterApi()
})

describe('TaskDetailModal — what it shows', () => {
  test('leads with the key and the title', async () => {
    render(<TaskDetailModal />)

    expect(await screen.findByText('ROS-101')).toBeInTheDocument()
    expect(screen.getByText('Fix connection pool leak on 504')).toBeInTheDocument()
  })

  test('renders the description as Markdown, not as source', async () => {
    render(<TaskDetailModal />)

    expect(await screen.findByRole('heading', { name: 'Steps' })).toBeInTheDocument()
    expect(screen.queryByText('## Steps')).not.toBeInTheDocument()
  })

  test('invites a description when there is none', () => {
    useRoster.setState({ tasks: [aTask({ id: 'ROS-101', description: '' })] })
    render(<TaskDetailModal />)

    expect(screen.getByText('No description. Click to add one.')).toBeInTheDocument()
  })

  test('reads the thread when the task opens', async () => {
    const api = installRosterApi({
      tasks: { comments: vi.fn().mockResolvedValue([aTaskComment({ text: 'a note' })]) },
    })
    render(<TaskDetailModal />)

    await waitFor(() => expect(api.tasks.comments).toHaveBeenCalledWith('ROS-101'))
    expect(await screen.findByText('a note')).toBeInTheDocument()
  })
})

describe('TaskDetailModal — the title', () => {
  test('click turns it into an input', async () => {
    const user = userEvent.setup()
    render(<TaskDetailModal />)

    await user.click(screen.getByText('Fix connection pool leak on 504'))

    expect(screen.getByLabelText('Task title')).toHaveValue(
      'Fix connection pool leak on 504',
    )
  })

  test('Enter saves the new title', async () => {
    const user = userEvent.setup()
    const api = installRosterApi({
      tasks: { apply: vi.fn().mockResolvedValue({ ...TASK, title: 'Renamed' }) },
    })
    render(<TaskDetailModal />)

    await user.click(screen.getByText('Fix connection pool leak on 504'))
    await user.clear(screen.getByLabelText('Task title'))
    await user.type(screen.getByLabelText('Task title'), 'Renamed{Enter}')

    expect(api.tasks.apply).toHaveBeenCalledWith('ROS-101', {
      field: 'title',
      value: 'Renamed',
    })
  })

  test('Escape abandons the edit without saving', async () => {
    const user = userEvent.setup()
    const api = installRosterApi()
    render(<TaskDetailModal />)

    await user.click(screen.getByText('Fix connection pool leak on 504'))
    await user.type(screen.getByLabelText('Task title'), ' more{Escape}')

    expect(api.tasks.apply).not.toHaveBeenCalled()
    expect(screen.getByText('Fix connection pool leak on 504')).toBeInTheDocument()
  })

  test('refuses to save an empty title', async () => {
    const user = userEvent.setup()
    const api = installRosterApi()
    render(<TaskDetailModal />)

    await user.click(screen.getByText('Fix connection pool leak on 504'))
    await user.clear(screen.getByLabelText('Task title'))
    await user.keyboard('{Enter}')

    // A card with no title on it would be unreadable on the board.
    expect(api.tasks.apply).not.toHaveBeenCalled()
  })
})

describe('TaskDetailModal — the description', () => {
  test('click swaps the rendered Markdown for its source', async () => {
    const user = userEvent.setup()
    render(<TaskDetailModal />)

    await user.click(await screen.findByRole('heading', { name: 'Steps' }))

    expect(screen.getByLabelText('Task description')).toHaveValue(
      '## Steps\n\n- reproduce\n- patch',
    )
  })

  test('Save writes it and Cancel does not', async () => {
    const user = userEvent.setup()
    const api = installRosterApi({
      tasks: { apply: vi.fn().mockResolvedValue(TASK) },
    })
    render(<TaskDetailModal />)

    await user.click(await screen.findByRole('heading', { name: 'Steps' }))
    await user.clear(screen.getByLabelText('Task description'))
    await user.type(screen.getByLabelText('Task description'), 'new body')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.tasks.apply).not.toHaveBeenCalled()

    await user.click(await screen.findByRole('heading', { name: 'Steps' }))
    await user.clear(screen.getByLabelText('Task description'))
    await user.type(screen.getByLabelText('Task description'), 'new body')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(api.tasks.apply).toHaveBeenCalledWith('ROS-101', {
      field: 'description',
      value: 'new body',
    })
  })
})

describe('TaskDetailModal — the rail', () => {
  test('shows the task as it stands', async () => {
    render(<TaskDetailModal />)

    expect(await screen.findByLabelText('Status')).toHaveValue('in_review')
    expect(screen.getByLabelText('Priority')).toHaveValue('urgent')
    expect(screen.getByLabelText('Assignee')).toHaveValue('')
    expect(screen.getByLabelText('Project')).toHaveValue('none')
  })

  test('changing the status moves the task', async () => {
    const user = userEvent.setup()
    const api = installRosterApi({ tasks: { apply: vi.fn().mockResolvedValue(TASK) } })
    render(<TaskDetailModal />)

    await user.selectOptions(await screen.findByLabelText('Status'), 'done')

    expect(api.tasks.apply).toHaveBeenCalledWith('ROS-101', {
      field: 'status',
      value: 'done',
    })
  })

  test('assigning by picking a suggestion sends the agent id', async () => {
    const user = userEvent.setup()
    const api = installRosterApi({ tasks: { apply: vi.fn().mockResolvedValue(TASK) } })
    render(<TaskDetailModal />)

    await user.click(await screen.findByLabelText('Assignee'))
    await user.click(screen.getByRole('option', { name: /Debugging Agent/ }))

    expect(api.tasks.apply).toHaveBeenCalledWith('ROS-101', {
      field: 'assignee',
      value: 'debugging',
    })
  })

  test('picking Unassigned sends null', async () => {
    const user = userEvent.setup()
    const api = installRosterApi({ tasks: { apply: vi.fn().mockResolvedValue(TASK) } })
    render(<TaskDetailModal />)

    await user.click(await screen.findByLabelText('Assignee'))
    await user.click(screen.getByRole('option', { name: /Unassigned/ }))

    expect(api.tasks.apply).toHaveBeenCalledWith('ROS-101', {
      field: 'assignee',
      value: null,
    })
  })

  test('filing under no project sends null rather than the sentinel', async () => {
    const user = userEvent.setup()
    const api = installRosterApi({ tasks: { apply: vi.fn().mockResolvedValue(TASK) } })
    useRoster.setState({ tasks: [aTask({ id: 'ROS-101', projectId: 'p1' })] })
    render(<TaskDetailModal />)

    await user.selectOptions(await screen.findByLabelText('Project'), 'none')

    expect(api.tasks.apply).toHaveBeenCalledWith('ROS-101', {
      field: 'project',
      value: null,
    })
  })

  test('labels can be added and removed', async () => {
    const user = userEvent.setup()
    const api = installRosterApi({ tasks: { apply: vi.fn().mockResolvedValue(TASK) } })
    render(<TaskDetailModal />)

    await user.click(await screen.findByRole('button', { name: 'Remove label bug' }))
    expect(api.tasks.apply).toHaveBeenCalledWith('ROS-101', {
      field: 'removeLabel',
      value: 'bug',
    })

    await user.click(screen.getByRole('button', { name: '+ Add' }))
    await user.type(screen.getByLabelText('New label'), 'api{Enter}')
    expect(api.tasks.apply).toHaveBeenCalledWith('ROS-101', {
      field: 'addLabel',
      value: 'api',
    })
  })
})

describe('TaskDetailModal — Comments and History', () => {
  const THREAD = [
    aTaskComment({ id: 'c1', text: 'Please prioritise.', isSystem: false }),
    aTaskComment({
      id: 'h1',
      author: 'Debugging Agent',
      tone: 'agent',
      text: 'Debugging Agent moved this to In Review.',
      isSystem: true,
    }),
  ]

  beforeEach(() => {
    installRosterApi({ tasks: { comments: vi.fn().mockResolvedValue(THREAD) } })
  })

  test('Comments shows what people wrote, not the change log', async () => {
    render(<TaskDetailModal />)

    expect(await screen.findByText('Please prioritise.')).toBeInTheDocument()
    expect(
      screen.queryByText('Debugging Agent moved this to In Review.'),
    ).not.toBeInTheDocument()
  })

  test('History shows the change log, not the conversation', async () => {
    const user = userEvent.setup()
    render(<TaskDetailModal />)

    await user.click(await screen.findByRole('tab', { name: 'History' }))

    expect(
      screen.getByText('Debugging Agent moved this to In Review.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Please prioritise.')).not.toBeInTheDocument()
  })

  test('the comment box belongs to Comments alone', async () => {
    const user = userEvent.setup()
    render(<TaskDetailModal />)

    expect(await screen.findByLabelText('Add a comment')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'History' }))
    // History is generated; there is nothing to add to it by hand.
    expect(screen.queryByLabelText('Add a comment')).not.toBeInTheDocument()
  })

  test('posts a comment on Enter', async () => {
    const user = userEvent.setup()
    const api = installRosterApi({
      tasks: {
        comments: vi.fn().mockResolvedValue(THREAD),
        comment: vi.fn().mockResolvedValue(aTaskComment()),
      },
    })
    render(<TaskDetailModal />)

    await user.type(await screen.findByLabelText('Add a comment'), 'on it{Enter}')

    expect(api.tasks.comment).toHaveBeenCalledWith('ROS-101', 'on it')
  })

  test('says so when a tab is empty', async () => {
    const user = userEvent.setup()
    installRosterApi({ tasks: { comments: vi.fn().mockResolvedValue([]) } })
    render(<TaskDetailModal />)

    expect(await screen.findByText('No comments yet.')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'History' }))
    expect(screen.getByText('Nothing has changed yet.')).toBeInTheDocument()
  })

  test('attributes each line to whoever is responsible for it', async () => {
    render(<TaskDetailModal />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('tab', { name: 'History' }))

    const thread = screen.getByRole('region', { name: 'Thread' })
    expect(within(thread).getByText('Debugging Agent')).toBeInTheDocument()
  })
})

describe('TaskDetailModal — closing', () => {
  test('the close button closes it', async () => {
    const user = userEvent.setup()
    render(<TaskDetailModal />)

    await user.click(await screen.findByRole('button', { name: 'Close' }))

    expect(useRoster.getState().openTaskId).toBeNull()
  })

  test('the backdrop closes it', async () => {
    const user = userEvent.setup()
    render(<TaskDetailModal />)

    await user.click(await screen.findByRole('dialog'))

    expect(useRoster.getState().openTaskId).toBeNull()
  })

  test('a click inside the card does not', async () => {
    const user = userEvent.setup()
    render(<TaskDetailModal />)

    await user.click(await screen.findByText('ROS-101'))

    expect(useRoster.getState().openTaskId).toBe('ROS-101')
  })

  test('Escape closes it', async () => {
    const user = userEvent.setup()
    render(<TaskDetailModal />)

    await user.keyboard('{Escape}')

    expect(useRoster.getState().openTaskId).toBeNull()
  })

  test('but Escape while editing the title only cancels the edit', async () => {
    const user = userEvent.setup()
    render(<TaskDetailModal />)

    await user.click(screen.getByText('Fix connection pool leak on 504'))
    await user.keyboard('{Escape}')

    // Closing the modal here would throw the edit away without saying so.
    expect(useRoster.getState().openTaskId).toBe('ROS-101')
  })

  test('renders nothing when no task is open', () => {
    useRoster.setState({ openTaskId: null })
    const { container } = render(<TaskDetailModal />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('TaskDetailModal — deleting', () => {
  test('offers a delete control on the task that is open', async () => {
    render(<TaskDetailModal />)

    expect(await screen.findByRole('button', { name: 'Delete ROS-101' })).toBeInTheDocument()
  })

  test('asks the main process to remove the task', async () => {
    const user = userEvent.setup()
    const api = installRosterApi()
    render(<TaskDetailModal />)

    await user.click(await screen.findByRole('button', { name: 'Delete ROS-101' }))

    expect(api.tasks.remove).toHaveBeenCalledWith('ROS-101')
  })

  test('drops the task and closes the modal once it is gone', async () => {
    const user = userEvent.setup()
    installRosterApi({ tasks: { remove: vi.fn().mockResolvedValue(true) } })
    render(<TaskDetailModal />)

    await user.click(await screen.findByRole('button', { name: 'Delete ROS-101' }))

    await waitFor(() => expect(useRoster.getState().openTaskId).toBeNull())
    expect(useRoster.getState().tasks).toEqual([])
  })

  test('keeps the task when the confirmation is dismissed', async () => {
    const user = userEvent.setup()
    // The dialog lives in the main process, so a cancel comes back as false
    // rather than as a rejection.
    installRosterApi({ tasks: { remove: vi.fn().mockResolvedValue(false) } })
    render(<TaskDetailModal />)

    await user.click(await screen.findByRole('button', { name: 'Delete ROS-101' }))

    await waitFor(() => expect(useRoster.getState().openTaskId).toBe('ROS-101'))
    expect(useRoster.getState().tasks).toHaveLength(1)
  })

  test('surfaces the reason a task could not be deleted', async () => {
    const user = userEvent.setup()
    installRosterApi({
      tasks: { remove: vi.fn().mockRejectedValue(new Error('database is locked')) },
    })
    render(<TaskDetailModal />)

    await user.click(await screen.findByRole('button', { name: 'Delete ROS-101' }))

    expect(await screen.findByText(/database is locked/)).toBeInTheDocument()
    // The modal stays put, or the message would vanish with it.
    expect(useRoster.getState().openTaskId).toBe('ROS-101')
  })
})

describe('TaskDetailModal — archived projects', () => {
  const PUT_AWAY = aProject({ id: 'p2', name: 'Q3 planning', archivedAt: 1_700_000_500_000 })

  test('the project picker does not offer an archived project', async () => {
    useRoster.setState({ projects: [aProject({ id: 'p1', name: 'API reliability' }), PUT_AWAY] })
    render(<TaskDetailModal />)

    const select = await screen.findByLabelText('Project')
    expect(within(select).getByText('API reliability')).toBeInTheDocument()
    expect(within(select).queryByText('Q3 planning')).not.toBeInTheDocument()
  })

  test('but a task already filed under one still shows it, marked archived', async () => {
    useRoster.setState({
      projects: [aProject({ id: 'p1', name: 'API reliability' }), PUT_AWAY],
      tasks: [{ ...TASK, projectId: 'p2' }],
    })
    render(<TaskDetailModal />)

    // A native select renders blank on a value it has no option for, which
    // would make the task read as unfiled and silently move it on save.
    const select = await screen.findByLabelText('Project')
    expect(within(select).getByText('Q3 planning (archived)')).toBeInTheDocument()
    expect(select).toHaveValue('p2')
  })
})
