import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ProjectsModal } from '@/screens/ProjectsModal'
import { NewTaskModal } from '@/screens/NewTaskModal'
import { ALL_PROJECTS, useRoster } from '@/state/store'
import { anAgent, aProject, aTask } from './factories'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()

const PROJECTS = [
  aProject({ id: 'p1', name: 'API reliability', description: 'Close out bugs.' }),
  aProject({ id: 'p2', name: 'Q3 planning', description: 'Break the roadmap down.' }),
]

const ARCHIVED = aProject({
  id: 'p3',
  name: 'Shipped work',
  description: 'Done and put away.',
  archivedAt: 1_700_000_500_000,
})

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  useRoster.setState({ projects: PROJECTS, projectsOpen: true })
  installRosterApi()
})

describe('ProjectsModal — the list', () => {
  test('lists every project with its description', () => {
    render(<ProjectsModal />)

    expect(screen.getByText('API reliability')).toBeInTheDocument()
    expect(screen.getByText('Close out bugs.')).toBeInTheDocument()
    expect(screen.getByText('Q3 planning')).toBeInTheDocument()
  })

  test('counts the tasks filed under each one', () => {
    useRoster.setState({
      tasks: [
        aTask({ id: 'ROS-1', projectId: 'p1' }),
        aTask({ id: 'ROS-2', projectId: 'p1' }),
        aTask({ id: 'ROS-3', projectId: 'p2' }),
      ],
    })
    render(<ProjectsModal />)

    expect(screen.getByText('2 tasks')).toBeInTheDocument()
    expect(screen.getByText('1 tasks')).toBeInTheDocument()
  })
})

describe('ProjectsModal — editing', () => {
  test('Edit opens the fields filled in', async () => {
    const user = userEvent.setup()
    render(<ProjectsModal />)

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0] as HTMLElement)

    expect(screen.getByLabelText('Project name')).toHaveValue('API reliability')
    expect(screen.getByLabelText('Project description')).toHaveValue('Close out bugs.')
  })

  test('Save writes the change', async () => {
    const user = userEvent.setup()
    const api = installRosterApi({
      projects: { update: vi.fn().mockResolvedValue(PROJECTS[0]) },
    })
    render(<ProjectsModal />)

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0] as HTMLElement)
    await user.clear(screen.getByLabelText('Project name'))
    await user.type(screen.getByLabelText('Project name'), 'Renamed')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(api.projects.update).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ name: 'Renamed' }),
      ),
    )
  })

  test('Cancel writes nothing', async () => {
    const user = userEvent.setup()
    const api = installRosterApi()
    render(<ProjectsModal />)

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0] as HTMLElement)
    await user.type(screen.getByLabelText('Project name'), 'x')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(api.projects.update).not.toHaveBeenCalled()
  })

  test('offers the six swatches, and marks the chosen one', async () => {
    const user = userEvent.setup()
    render(<ProjectsModal />)

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0] as HTMLElement)

    const swatches = screen.getAllByRole('button', { name: /^Colour / })
    expect(swatches).toHaveLength(6)
    expect(swatches.filter((s) => s.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
  })

  test('picking a swatch changes which is marked', async () => {
    const user = userEvent.setup()
    render(<ProjectsModal />)

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0] as HTMLElement)
    const swatches = screen.getAllByRole('button', { name: /^Colour / })
    await user.click(swatches[2] as HTMLElement)

    expect(swatches[2]).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('ProjectsModal — creating', () => {
  test('the dashed row opens an empty form', async () => {
    const user = userEvent.setup()
    render(<ProjectsModal />)

    await user.click(screen.getByRole('button', { name: '+ New project' }))

    expect(screen.getByLabelText('Project name')).toHaveValue('')
  })

  test('Create is refused until the project has a name', async () => {
    const user = userEvent.setup()
    render(<ProjectsModal />)

    await user.click(screen.getByRole('button', { name: '+ New project' }))
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()

    await user.type(screen.getByLabelText('Project name'), 'New one')
    expect(screen.getByRole('button', { name: 'Create' })).not.toBeDisabled()
  })

  test('Create writes it', async () => {
    const user = userEvent.setup()
    const api = installRosterApi({
      projects: { create: vi.fn().mockResolvedValue(aProject({ id: 'p3' })) },
    })
    render(<ProjectsModal />)

    await user.click(screen.getByRole('button', { name: '+ New project' }))
    await user.type(screen.getByLabelText('Project name'), 'New one')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(api.projects.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New one' }),
      ),
    )
  })
})

describe('ProjectsModal — the two tabs', () => {
  test('the list starts on Active, and archived projects are not in it', () => {
    useRoster.setState({ projects: [...PROJECTS, ARCHIVED] })
    render(<ProjectsModal />)

    expect(screen.getByText('API reliability')).toBeInTheDocument()
    expect(screen.queryByText('Shipped work')).not.toBeInTheDocument()
  })

  test('the Archived tab shows only the archived ones', async () => {
    const user = userEvent.setup()
    useRoster.setState({ projects: [...PROJECTS, ARCHIVED] })
    render(<ProjectsModal />)

    await user.click(screen.getByRole('tab', { name: 'Archived' }))

    expect(screen.getByText('Shipped work')).toBeInTheDocument()
    expect(screen.queryByText('API reliability')).not.toBeInTheDocument()
  })

  test('says when there is nothing archived', async () => {
    const user = userEvent.setup()
    render(<ProjectsModal />)

    await user.click(screen.getByRole('tab', { name: 'Archived' }))

    expect(screen.getByText('No archived projects.')).toBeInTheDocument()
  })

  test('new projects can only be started from Active', async () => {
    const user = userEvent.setup()
    useRoster.setState({ projects: [...PROJECTS, ARCHIVED] })
    render(<ProjectsModal />)

    expect(screen.getByRole('button', { name: '+ New project' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Archived' }))

    expect(screen.queryByRole('button', { name: '+ New project' })).not.toBeInTheDocument()
  })

  test('says when there are no projects at all', () => {
    useRoster.setState({ projects: [] })
    render(<ProjectsModal />)

    expect(screen.getByText('No projects yet.')).toBeInTheDocument()
  })
})

describe('ProjectsModal — archiving', () => {
  test('an active project offers Archive, not Delete', () => {
    render(<ProjectsModal />)

    expect(screen.getAllByRole('button', { name: 'Archive' })).toHaveLength(2)
    // Destroying a project always takes two deliberate steps now.
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  test('Archive puts the project away', async () => {
    const user = userEvent.setup()
    const api = installRosterApi()
    render(<ProjectsModal />)

    await user.click(screen.getAllByRole('button', { name: 'Archive' })[0] as HTMLElement)

    await waitFor(() => expect(api.projects.setArchived).toHaveBeenCalledWith('p1', true))
  })

  test('keeps its tasks, unlike Delete', async () => {
    const user = userEvent.setup()
    useRoster.setState({ tasks: [aTask({ id: 'ROS-1', projectId: 'p1' })] })
    installRosterApi({
      projects: { list: vi.fn().mockResolvedValue([{ ...PROJECTS[0], archivedAt: 1 }]) },
    })
    render(<ProjectsModal />)

    await user.click(screen.getAllByRole('button', { name: 'Archive' })[0] as HTMLElement)

    // Archiving hides the work; restoring has to be able to bring it back.
    await waitFor(() => expect(useRoster.getState().projects[0]?.archivedAt).toBe(1))
    expect(useRoster.getState().tasks[0]?.projectId).toBe('p1')
  })

  test('clears a filter that pointed at it', async () => {
    const user = userEvent.setup()
    // The filter no longer offers it, so leaving it set would show an empty
    // board with no way to tell why.
    useRoster.setState({ projectFilter: 'p1' })
    render(<ProjectsModal />)

    await user.click(screen.getAllByRole('button', { name: 'Archive' })[0] as HTMLElement)

    await waitFor(() => expect(useRoster.getState().projectFilter).toBe(ALL_PROJECTS))
  })

  test('leaves a filter pointing at a different project alone', async () => {
    const user = userEvent.setup()
    useRoster.setState({ projectFilter: 'p2' })
    render(<ProjectsModal />)

    await user.click(screen.getAllByRole('button', { name: 'Archive' })[0] as HTMLElement)

    await waitFor(() => expect(useRoster.getState().projectFilter).toBe('p2'))
  })

  test('says so when it fails, and changes nothing', async () => {
    const user = userEvent.setup()
    installRosterApi({
      projects: { setArchived: vi.fn().mockRejectedValue(new Error('database is locked')) },
    })
    useRoster.setState({ projectFilter: 'p1' })
    render(<ProjectsModal />)

    await user.click(screen.getAllByRole('button', { name: 'Archive' })[0] as HTMLElement)

    expect(await screen.findByText('database is locked')).toBeInTheDocument()
    expect(useRoster.getState().projectFilter).toBe('p1')
  })
})

describe('ProjectsModal — restoring', () => {
  beforeEach(() => {
    useRoster.setState({ projects: [ARCHIVED] })
  })

  test('an archived project offers Restore and Delete, not Archive', async () => {
    const user = userEvent.setup()
    render(<ProjectsModal />)
    await user.click(screen.getByRole('tab', { name: 'Archived' }))

    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
  })

  test('says when it was put away', async () => {
    const user = userEvent.setup()
    render(<ProjectsModal />)
    await user.click(screen.getByRole('tab', { name: 'Archived' }))

    expect(screen.getByText(/^Archived /)).toBeInTheDocument()
  })

  test('Restore brings it back', async () => {
    const user = userEvent.setup()
    const api = installRosterApi()
    render(<ProjectsModal />)
    await user.click(screen.getByRole('tab', { name: 'Archived' }))

    await user.click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(api.projects.setArchived).toHaveBeenCalledWith('p3', false))
  })

  test('still counts the tasks filed under it', async () => {
    const user = userEvent.setup()
    useRoster.setState({ tasks: [aTask({ id: 'ROS-1', projectId: 'p3' })] })
    render(<ProjectsModal />)
    await user.click(screen.getByRole('tab', { name: 'Archived' }))

    // The work is hidden, not gone — the count is what says so.
    expect(screen.getByText('1 tasks')).toBeInTheDocument()
  })
})

describe('ProjectsModal — deleting', () => {
  beforeEach(() => {
    useRoster.setState({ projects: [ARCHIVED] })
  })

  async function openArchivedAndDelete(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('tab', { name: 'Archived' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
  }

  test('deletes the project', async () => {
    const user = userEvent.setup()
    const api = installRosterApi()
    render(<ProjectsModal />)

    await openArchivedAndDelete(user)

    await waitFor(() => expect(api.projects.remove).toHaveBeenCalledWith('p3'))
  })

  test('detaches its tasks rather than losing them', async () => {
    const user = userEvent.setup()
    useRoster.setState({ tasks: [aTask({ id: 'ROS-1', projectId: 'p3' })] })
    render(<ProjectsModal />)

    await openArchivedAndDelete(user)

    await waitFor(() => {
      const tasks = useRoster.getState().tasks
      expect(tasks).toHaveLength(1)
      expect(tasks[0]?.projectId).toBeNull()
    })
  })

  test('clears a filter that pointed at it', async () => {
    const user = userEvent.setup()
    // An unreachable filter would show an empty board with no way to tell why.
    useRoster.setState({ projectFilter: 'p3' })
    render(<ProjectsModal />)

    await openArchivedAndDelete(user)

    await waitFor(() => expect(useRoster.getState().projectFilter).toBe(ALL_PROJECTS))
  })

  test('leaves a filter pointing at a different project alone', async () => {
    const user = userEvent.setup()
    useRoster.setState({ projects: [...PROJECTS, ARCHIVED], projectFilter: 'p2' })
    render(<ProjectsModal />)

    await openArchivedAndDelete(user)

    await waitFor(() => expect(useRoster.getState().projectFilter).toBe('p2'))
  })

  test('a dismissed confirmation changes nothing', async () => {
    const user = userEvent.setup()
    // The dialog lives in the main process; false is how it says "cancelled".
    installRosterApi({ projects: { remove: vi.fn().mockResolvedValue(false) } })
    useRoster.setState({ tasks: [aTask({ id: 'ROS-1', projectId: 'p3' })], projectFilter: 'p3' })
    render(<ProjectsModal />)

    await openArchivedAndDelete(user)

    await waitFor(() => expect(useRoster.getState().tasks[0]?.projectId).toBe('p3'))
    expect(useRoster.getState().projectFilter).toBe('p3')
    expect(useRoster.getState().projects).toEqual([ARCHIVED])
  })
})

describe('NewTaskModal', () => {
  beforeEach(() => {
    useRoster.setState({
      newTaskOpen: true,
      agents: [anAgent({ id: 'debugging', name: 'Debugging Agent' })],
    })
  })

  test('refuses to create a task with no title', async () => {
    render(<NewTaskModal />)
    expect(screen.getByRole('button', { name: 'Create task' })).toBeDisabled()
  })

  test('creates the task and puts it on the board', async () => {
    const user = userEvent.setup()
    const created = aTask({ id: 'ROS-9', title: 'A new one' })
    const api = installRosterApi({ tasks: { create: vi.fn().mockResolvedValue(created) } })
    render(<NewTaskModal />)

    await user.type(screen.getByLabelText('Task title'), 'A new one')
    await user.selectOptions(screen.getByLabelText('Assignee'), 'debugging')
    await user.selectOptions(screen.getByLabelText('Priority'), 'urgent')
    await user.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() =>
      expect(api.tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'A new one',
          assigneeId: 'debugging',
          priority: 'urgent',
        }),
      ),
    )
    await waitFor(() => expect(useRoster.getState().tasks).toContainEqual(created))
  })

  test('inherits the project you are already filtered to', () => {
    // Retyping the filter you are looking at is busywork.
    useRoster.setState({ projectFilter: 'p2' })
    render(<NewTaskModal />)

    expect(screen.getByLabelText('Project')).toHaveValue('p2')
  })

  test('defaults to no project when nothing is filtered', () => {
    render(<NewTaskModal />)
    expect(screen.getByLabelText('Project')).toHaveValue('none')
  })

  test('sends null rather than the sentinel for no project', async () => {
    const user = userEvent.setup()
    const api = installRosterApi({ tasks: { create: vi.fn().mockResolvedValue(aTask()) } })
    render(<NewTaskModal />)

    await user.type(screen.getByLabelText('Task title'), 'A new one')
    await user.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() =>
      expect(api.tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: null, assigneeId: null }),
      ),
    )
  })

  test('carries labels through', async () => {
    const user = userEvent.setup()
    const api = installRosterApi({ tasks: { create: vi.fn().mockResolvedValue(aTask()) } })
    render(<NewTaskModal />)

    await user.type(screen.getByLabelText('Task title'), 'A new one')
    await user.click(screen.getByRole('button', { name: '+ Add' }))
    await user.type(screen.getByLabelText('New label'), 'bug{Enter}')
    await user.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() =>
      expect(api.tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({ labels: ['bug'] }),
      ),
    )
  })

  test('a label can be taken off again before the task exists', async () => {
    const user = userEvent.setup()
    render(<NewTaskModal />)

    await user.click(screen.getByRole('button', { name: '+ Add' }))
    await user.type(screen.getByLabelText('New label'), 'bug{Enter}')
    expect(screen.getByText('bug')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove label bug' }))
    expect(screen.queryByText('bug')).not.toBeInTheDocument()
  })

  test('Escape on the label input cancels only the label', async () => {
    const user = userEvent.setup()
    render(<NewTaskModal />)

    await user.click(screen.getByRole('button', { name: '+ Add' }))
    await user.type(screen.getByLabelText('New label'), 'bug{Escape}')

    expect(screen.queryByText('bug')).not.toBeInTheDocument()
    expect(useRoster.getState().newTaskOpen).toBe(true)
  })
})
