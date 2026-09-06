import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { AgentsGrid } from '@/screens/AgentsGrid'
import { useRoster } from '@/state/store'
import { anAgent, aProject, aSession, aTask } from './factories'

const INITIAL = useRoster.getState()

const AGENTS = [
  anAgent({ id: 'architect', name: 'Architect Agent' }),
  anAgent({ id: 'debugging', name: 'Debugging Agent' }),
]

const PROJECT = aProject({ id: 'proj-a', name: 'API reliability' })

/** A mention opened `root`; it handed the work to `kid`. */
const SESSIONS = {
  architect: [
    aSession({
      id: 'root',
      agentId: 'architect',
      title: 'Multi-region session store',
      status: 'running',
      projectId: 'proj-a',
      taskId: 'ROS-101',
    }),
  ],
  debugging: [
    aSession({
      id: 'kid',
      agentId: 'debugging',
      title: 'Session leak on 504',
      status: 'approval',
      origin: 'agent',
      projectId: 'proj-a',
      spawnedFrom: { agentId: 'architect', sessionId: 'root', label: 'Architect Agent' },
    }),
  ],
}

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  useRoster.setState({
    agents: AGENTS,
    sessions: SESSIONS,
    projects: [PROJECT],
    tasks: [aTask({ id: 'ROS-101', title: 'Fix the pool leak', projectId: 'proj-a' })],
    loaded: true,
    gridView: 'workflow',
  })
})

describe('the Cards/Workflow switcher', () => {
  test('the grid shows cards until Workflow is picked', async () => {
    // Arrange
    useRoster.setState({ gridView: 'cards' })
    render(<AgentsGrid />)
    expect(screen.queryByLabelText(/Open Architect Agent/)).not.toBeInTheDocument()

    // Act
    await userEvent.click(screen.getByRole('tab', { name: 'Workflow' }))

    // Assert
    expect(useRoster.getState().gridView).toBe('workflow')
    expect(screen.getByLabelText(/Open Architect Agent/)).toBeInTheDocument()
  })

  test('the agent filter and New agent belong to the cards view', () => {
    render(<AgentsGrid />)

    expect(screen.queryByLabelText('Filter agents')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New agent' })).not.toBeInTheDocument()
  })

  test('the summary counts what is on the canvas, not the agent cards', () => {
    // The card counts are about agents. Over a graph of sessions they answer
    // a question nobody asked, and get the number wrong doing it.
    render(<AgentsGrid />)

    expect(screen.getByText('2 sessions · 1 running')).toBeInTheDocument()
  })

  test('counts one session without pluralising it', () => {
    useRoster.setState({ sessions: { architect: SESSIONS.architect } })
    render(<AgentsGrid />)

    expect(screen.getByText('1 session · 1 running')).toBeInTheDocument()
  })
})

describe('the workflow graph', () => {
  test('draws a node per session, naming its agent and what it is called', () => {
    render(<AgentsGrid />)

    expect(screen.getByText('Architect Agent')).toBeInTheDocument()
    expect(screen.getByText('Multi-region session store')).toBeInTheDocument()
    expect(screen.getByText('Session leak on 504')).toBeInTheDocument()
  })

  test("a node carries its session's status, project and task", () => {
    render(<AgentsGrid />)

    const node = screen.getByLabelText('Open Debugging Agent · Session leak on 504')
    // The handoff's own wording for the status.
    expect(within(node).getByText('needs you')).toBeInTheDocument()
    expect(within(node).getByText('API reliability')).toBeInTheDocument()

    const root = screen.getByLabelText('Open Architect Agent · Multi-region session store')
    expect(within(root).getByText('ROS-101')).toBeInTheDocument()
    // Only a session a mention opened carries a task.
    expect(within(node).queryByText('ROS-101')).not.toBeInTheDocument()
  })

  test('joins each handoff with an edge', () => {
    const { container } = render(<AgentsGrid />)

    expect(container.querySelectorAll('svg path')).toHaveLength(1)
  })

  test('clicking a node opens that agent at that session', async () => {
    render(<AgentsGrid />)

    await userEvent.click(screen.getByLabelText('Open Debugging Agent · Session leak on 504'))

    expect(useRoster.getState().screen).toBe('agent')
    expect(useRoster.getState().agentId).toBe('debugging')
    expect(useRoster.getState().sess['debugging']).toBe('kid')
  })

  test('says so when there is nothing to draw', () => {
    useRoster.setState({ sessions: {} })
    render(<AgentsGrid />)

    expect(screen.getByText(/No sessions/)).toBeInTheDocument()
  })
})

describe('the task filter', () => {
  test('waits for a project to be picked', () => {
    render(<AgentsGrid />)

    const select = screen.getByLabelText('Filter by task')
    expect(select).toBeDisabled()
    expect(within(select).getByText('Pick a project first')).toBeInTheDocument()
  })

  test('offers that project’s tasks once one is picked', async () => {
    useRoster.setState({ projectFilter: 'proj-a' })
    render(<AgentsGrid />)

    const select = screen.getByLabelText('Filter by task')
    expect(select).toBeEnabled()
    expect(within(select).getByText('ROS-101 · Fix the pool leak')).toBeInTheDocument()
  })

  test('picking a task narrows the graph to the sessions its work reached', async () => {
    // Arrange — a third session, unrelated to the task.
    useRoster.setState({
      projectFilter: 'proj-a',
      sessions: {
        ...SESSIONS,
        architect: [
          ...SESSIONS.architect,
          aSession({ id: 'other', agentId: 'architect', title: 'Unrelated', projectId: 'proj-a' }),
        ],
      },
    })
    render(<AgentsGrid />)

    // Act
    await userEvent.selectOptions(screen.getByLabelText('Filter by task'), 'ROS-101')

    // Assert — the handed-off session comes along; the unrelated one does not.
    expect(screen.getByText('Session leak on 504')).toBeInTheDocument()
    expect(screen.queryByText('Unrelated')).not.toBeInTheDocument()
  })

  test('a task chosen from a task panel shows even with no project filter', () => {
    // openWorkflowForTask on an unfiled task leaves the project filter alone,
    // so the select has to stay usable to show what it is filtered to.
    useRoster.setState({ workflowTaskId: 'ROS-101' })
    render(<AgentsGrid />)

    expect(screen.getByLabelText('Filter by task')).toBeEnabled()
  })
})
