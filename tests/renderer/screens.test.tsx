import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { EditAgentModal } from '@/screens/EditAgentModal'
import { McpServers } from '@/screens/McpServers'
import { NewAgent } from '@/screens/NewAgent'
import { Skills, relativeTime } from '@/screens/Skills'
import { Tasks } from '@/screens/Tasks'
import { AgentsGrid } from '@/screens/AgentsGrid'
import { Sidebar } from '@/components/Sidebar'
import { ALL_PROJECTS, useRoster } from '@/state/store'
import { anAgent, aProject, aRunner, aSkill, aTask, anMcpServer } from './factories'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  installRosterApi()
})

/* ----------------------------------------------------------------- sidebar */

describe('Sidebar', () => {
  beforeEach(() => {
    useRoster.setState({
      agents: [anAgent({ id: 'a', name: 'Architect Agent' }), anAgent({ id: 'b', name: 'Review Agent' })],
      skills: [aSkill()],
      mcpServers: [anMcpServer()],
    })
  })

  test('counts what each section holds', () => {
    render(<Sidebar />)

    expect(screen.getByRole('button', { name: /^Agents/ })).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: /^Skills/ })).toHaveTextContent('1')
  })

  test('shows which build is running, so an update prompt can be read', () => {
    useRoster.setState({ appVersion: '0.1.4' })
    render(<Sidebar />)

    expect(screen.getByText('v0.1.4')).toBeInTheDocument()
  })

  test('says nothing about the version before main has reported one', () => {
    render(<Sidebar />)

    expect(screen.queryByText(/^v\d/)).not.toBeInTheDocument()
  })

  test('Spend is a real screen, quoting the roster-wide running total', () => {
    useRoster.setState({
      agentUsage: {
        debugging: { tokens: 800, costUsd: 1.43 },
        review: { tokens: 200, costUsd: 0.48 },
      },
    })
    render(<Sidebar />)

    const spend = screen.getByRole('button', { name: /Spend/ })
    expect(spend).toBeEnabled()
    expect(spend).toHaveTextContent('$1.91')
  })

  test('Tasks is a real screen, counting what is on the board', () => {
    useRoster.setState({ tasks: [aTask({ id: 'ROS-1' }), aTask({ id: 'ROS-2' })] })
    render(<Sidebar />)

    const tasks = screen.getByRole('button', { name: /Tasks/ })
    expect(tasks).not.toBeDisabled()
    expect(tasks).toHaveTextContent('2')
  })

  test('navigates to the board', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.click(screen.getByRole('button', { name: /Tasks/ }))

    expect(useRoster.getState().screen).toBe('tasks')
  })

  test('navigates between screens', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.click(screen.getByRole('button', { name: /MCP servers/ }))
    expect(useRoster.getState().screen).toBe('mcp')
  })

  test('filters the roster list and reports the match count', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.type(screen.getByLabelText('Search agents'), 'review')

    expect(screen.queryByText('Architect Agent')).not.toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  test('clicking an agent opens it', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.click(screen.getByText('Review Agent'))
    expect(useRoster.getState().agentId).toBe('b')
  })

  test('the window controls are real', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.click(screen.getByLabelText('Close window'))
    expect(window.roster.window.close).toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ skills */

describe('Skills', () => {
  const SKILLS = [
    aSkill({ name: 'adr-writer', path: '/skills/adr-writer', files: ['SKILL.md'] }),
    aSkill({ name: 'repro-harness', path: '/skills/repro-harness', files: ['SKILL.md', 'repro.py'] }),
  ]

  beforeEach(() => {
    installRosterApi({ skills: { read: vi.fn().mockResolvedValue('# ADR Writer\n\nBody.') } })
    useRoster.setState({ skills: SKILLS, agents: [anAgent({ skills: ['adr-writer'] })] })
  })

  test('lists every skill and its files in the tree', () => {
    render(<Skills />)

    expect(screen.getByText('adr-writer')).toBeInTheDocument()
    expect(screen.getByText('repro.py')).toBeInTheDocument()
  })

  test('opens the first SKILL.md automatically', async () => {
    render(<Skills />)

    await waitFor(() =>
      expect(screen.getByLabelText('Skill file contents')).toHaveValue('# ADR Writer\n\nBody.'),
    )
  })

  test('marks the file unsaved once edited, and Save clears it', async () => {
    const user = userEvent.setup()
    render(<Skills />)
    const box = await screen.findByLabelText('Skill file contents')
    await waitFor(() => expect(box).toHaveValue('# ADR Writer\n\nBody.'))

    await user.type(box, ' more')
    expect(screen.getByText('unsaved')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByText('unsaved')).not.toBeInTheDocument())
    expect(window.roster.skills.write).toHaveBeenCalled()
  })

  test('Revert restores the file as last saved', async () => {
    const user = userEvent.setup()
    render(<Skills />)
    const box = await screen.findByLabelText('Skill file contents')
    await waitFor(() => expect(box).toHaveValue('# ADR Writer\n\nBody.'))

    await user.type(box, ' scratch')
    await user.click(screen.getByRole('button', { name: 'Revert' }))

    expect(box).toHaveValue('# ADR Writer\n\nBody.')
  })

  test('lists the agents using the open skill', async () => {
    render(<Skills />)
    expect(await screen.findByText('Debugging Agent')).toBeInTheDocument()
  })

  test('surfaces a read failure instead of showing an empty editor', async () => {
    installRosterApi({ skills: { read: vi.fn().mockRejectedValue(new Error('EACCES: denied')) } })
    render(<Skills />)

    expect(await screen.findByText(/EACCES: denied/)).toBeInTheDocument()
  })

  test('says so when the library is empty', () => {
    useRoster.setState({ skills: [] })
    render(<Skills />)

    expect(screen.getByText('No skills yet.')).toBeInTheDocument()
  })
})

describe('relativeTime', () => {
  const NOW = 1_800_000_000_000

  test.each([
    [30_000, 'just now'],
    [5 * 60_000, '5 minutes ago'],
    [60_000, '1 minute ago'],
    [2 * 3_600_000, '2 hours ago'],
    [3 * 86_400_000, '3 days ago'],
  ])('renders %i ms ago as %s', (ago, expected) => {
    expect(relativeTime(NOW - ago, NOW)).toBe(expected)
  })

  test('never reads as being in the future', () => {
    expect(relativeTime(NOW + 60_000, NOW)).toBe('just now')
  })
})

/* --------------------------------------------------------------------- mcp */

describe('Skills — adding one you already have', () => {
  beforeEach(() => {
    useRoster.setState({ skills: [] })
  })

  test('asks for a folder and links it', async () => {
    const user = userEvent.setup()
    installRosterApi({
      dialog: { chooseDirectory: vi.fn().mockResolvedValue('/repo/pr-triage') },
      skills: {
        link: vi.fn().mockResolvedValue(aSkill({ name: 'pr-triage', path: '/skills/pr-triage' })),
        list: vi.fn().mockResolvedValue([]),
      },
    })
    render(<Skills />)

    await user.click(screen.getByRole('button', { name: 'Add skill' }))

    await waitFor(() =>
      expect(window.roster.skills.link).toHaveBeenCalledWith('/repo/pr-triage'),
    )
  })

  test('links nothing when the picker is cancelled', async () => {
    const user = userEvent.setup()
    installRosterApi({ dialog: { chooseDirectory: vi.fn().mockResolvedValue(null) } })
    render(<Skills />)

    await user.click(screen.getByRole('button', { name: 'Add skill' }))

    await waitFor(() => expect(window.roster.skills.link).not.toHaveBeenCalled())
  })

  test('says why when the folder is not a skill', async () => {
    const user = userEvent.setup()
    installRosterApi({
      dialog: { chooseDirectory: vi.fn().mockResolvedValue('/repo/src') },
      skills: {
        link: vi.fn().mockRejectedValue(new Error('src has no SKILL.md, so it is not a skill')),
        list: vi.fn().mockResolvedValue([]),
      },
    })
    render(<Skills />)

    await user.click(screen.getByRole('button', { name: 'Add skill' }))

    expect(await screen.findByText(/has no SKILL\.md/)).toBeInTheDocument()
  })

  test('marks a linked skill, since editing it edits the original', () => {
    useRoster.setState({
      skills: [aSkill({ name: 'pr-triage', linkedFrom: '/repo/pr-triage', files: ['SKILL.md'] })],
    })
    render(<Skills />)

    expect(screen.getByLabelText('linked')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove linked skill pr-triage' }),
    ).toBeInTheDocument()
  })

  test('a skill of your own is not marked and still says Delete', () => {
    useRoster.setState({ skills: [aSkill({ name: 'mine', files: ['SKILL.md'] })] })
    render(<Skills />)

    expect(screen.queryByLabelText('linked')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete skill mine' })).toBeInTheDocument()
  })
})

describe('the project filter', () => {
  beforeEach(() => {
    useRoster.setState({
      projects: [aProject({ id: 'p1', name: 'Roster API' })],
      projectFilter: ALL_PROJECTS,
      agents: [anAgent({ id: 'debugging', name: 'Debugging Agent' })],
      sessions: {},
      tasks: [],
    })
  })

  test('is one filter, so choosing on the board holds on the grid', async () => {
    const user = userEvent.setup()
    const board = render(<Tasks />)
    await user.selectOptions(screen.getByLabelText('Filter by project'), 'p1')
    board.unmount()

    render(<AgentsGrid />)

    // The two screens kept separate state once; picking a project on one left
    // the other showing everything.
    expect(screen.getByLabelText('Filter by project')).toHaveValue('p1')
  })

  test('and choosing on the grid holds on the board', async () => {
    const user = userEvent.setup()
    const grid = render(<AgentsGrid />)
    await user.selectOptions(screen.getByLabelText('Filter by project'), 'p1')
    grid.unmount()

    render(<Tasks />)

    expect(screen.getByLabelText('Filter by project')).toHaveValue('p1')
  })

  test('offers the same options on both screens', () => {
    const board = render(<Tasks />)
    const onBoard = Array.from(
      screen.getByLabelText('Filter by project').querySelectorAll('option'),
    ).map((option) => option.textContent)
    board.unmount()

    render(<AgentsGrid />)
    const onGrid = Array.from(
      screen.getByLabelText('Filter by project').querySelectorAll('option'),
    ).map((option) => option.textContent)

    expect(onGrid).toEqual(onBoard)
    expect(onGrid).toEqual(['All projects', 'Roster API'])
  })
})

describe('McpServers', () => {
  beforeEach(() => {
    useRoster.setState({
      mcpServers: [
        anMcpServer({ name: 'filesystem' }),
        anMcpServer({ name: 'github', command: 'npx server-github' }),
      ],
      // Enablement lives on the agent, not on the server.
      agents: [
        anAgent({ id: 'debugging', name: 'Debugging Agent', mcpServers: ['filesystem'] }),
      ],
    })
  })

  test('lists installed servers with their launch commands', () => {
    render(<McpServers />)

    expect(screen.getByText('filesystem')).toBeInTheDocument()
    expect(screen.getByText('npx server-github')).toBeInTheDocument()
  })

  test('summarises how many agents each server is wired into', () => {
    render(<McpServers />)

    expect(screen.getByText('1 agent')).toBeInTheDocument()
    expect(screen.getByText('0 agents')).toBeInTheDocument()
  })

  test('shows which agents a server is enabled for', () => {
    render(<McpServers />)

    const chips = screen.getAllByRole('button', { name: 'Debugging' })
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true')
    expect(chips[1]).toHaveAttribute('aria-pressed', 'false')
  })

  test('toggling writes the change through', async () => {
    const user = userEvent.setup()
    render(<McpServers />)

    await user.click(screen.getAllByRole('button', { name: 'Debugging' })[1]!)

    expect(window.roster.mcp.setEnabled).toHaveBeenCalledWith('github', 'debugging', true)
  })

  test('toggling off reports the server the chip belongs to', async () => {
    const user = userEvent.setup()
    render(<McpServers />)

    // The first chip is filesystem's, which this agent already has on.
    await user.click(screen.getAllByRole('button', { name: 'Debugging' })[0]!)

    expect(window.roster.mcp.setEnabled).toHaveBeenCalledWith('filesystem', 'debugging', false)
  })

  test('a built-in is listed with what it does, not a launch command', () => {
    useRoster.setState({
      mcpServers: [
        anMcpServer({
          name: 'tasks',
          command: '',
          builtin: true,
          description: 'Read and change tasks on the shared board.',
        }),
      ],
      agents: [anAgent({ id: 'debugging', name: 'Debugging Agent', mcpServers: [] })],
    })
    render(<McpServers />)

    expect(screen.getByText('tasks')).toBeInTheDocument()
    expect(screen.getByText('Built in')).toBeInTheDocument()
    expect(screen.getByText('Read and change tasks on the shared board.')).toBeInTheDocument()
  })

  test('a built-in has nothing to configure, so it does not open the editor', () => {
    useRoster.setState({
      mcpServers: [anMcpServer({ name: 'tasks', command: '', builtin: true, description: 'The board.' })],
      agents: [anAgent({ id: 'debugging', name: 'Debugging Agent', mcpServers: [] })],
    })
    render(<McpServers />)

    // There is no command and no environment; save would be refused anyway.
    expect(screen.queryByRole('button', { name: 'Configure tasks' })).not.toBeInTheDocument()
  })

  test('a built-in is still enabled per agent, like any other server', async () => {
    const user = userEvent.setup()
    useRoster.setState({
      mcpServers: [anMcpServer({ name: 'tasks', command: '', builtin: true, description: 'The board.' })],
      agents: [anAgent({ id: 'debugging', name: 'Debugging Agent', mcpServers: [] })],
    })
    render(<McpServers />)

    await user.click(screen.getByRole('button', { name: 'Debugging' }))

    expect(window.roster.mcp.setEnabled).toHaveBeenCalledWith('tasks', 'debugging', true)
  })

  test('re-reads the agents, since enablement lives in agent.toml', async () => {
    const user = userEvent.setup()
    installRosterApi({
      agents: {
        list: vi
          .fn()
          .mockResolvedValue([
            anAgent({ id: 'debugging', name: 'Debugging Agent', mcpServers: ['filesystem', 'github'] }),
          ]),
      },
    })
    useRoster.setState({
      mcpServers: [anMcpServer({ name: 'filesystem' }), anMcpServer({ name: 'github' })],
      agents: [anAgent({ id: 'debugging', name: 'Debugging Agent', mcpServers: ['filesystem'] })],
    })
    render(<McpServers />)

    await user.click(screen.getAllByRole('button', { name: 'Debugging' })[1]!)

    // The chip must follow the file, not a local guess — this is the join
    // that used to be written to one place and read from another.
    await waitFor(() =>
      expect(useRoster.getState().agents[0]?.mcpServers).toEqual(['filesystem', 'github']),
    )
    expect(screen.getAllByRole('button', { name: 'Debugging' })[1]).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('a server no agent names shows as wired into nobody', () => {
    useRoster.setState({
      mcpServers: [anMcpServer({ name: 'sqlite' })],
      agents: [anAgent({ id: 'debugging', name: 'Debugging Agent', mcpServers: [] })],
    })
    render(<McpServers />)

    expect(screen.getByText('0 agents')).toBeInTheDocument()
  })

  test('the registry tab groups servers by category', async () => {
    const user = userEvent.setup()
    render(<McpServers />)

    await user.click(screen.getByRole('tab', { name: 'Registry' }))

    expect(screen.getByRole('heading', { name: 'gitlab' })).toBeInTheDocument()
    // By heading, not by text: Notion publishes its own server, so "notion"
    // is also the author line underneath.
    expect(screen.getByRole('heading', { name: 'notion' })).toBeInTheDocument()
  })

  test('an already-installed registry entry cannot be installed twice', async () => {
    const user = userEvent.setup()
    render(<McpServers />)
    await user.click(screen.getByRole('tab', { name: 'Registry' }))

    expect(screen.getByRole('button', { name: 'Installed' })).toBeDisabled()
  })

  test('says so when nothing is configured', () => {
    useRoster.setState({ mcpServers: [] })
    render(<McpServers />)

    expect(screen.getByText('No MCP servers configured yet.')).toBeInTheDocument()
  })
})

/* ---------------------------------------------------------------- new agent */

describe('NewAgent', () => {
  beforeEach(() => {
    installRosterApi({
      runners: {
        models: vi.fn().mockResolvedValue([
          { id: 'claude-opus-5', price: '$5 / $25' },
          { id: 'claude-haiku-4-5', price: '$1 / $5' },
        ]),
      },
      agents: { create: vi.fn().mockResolvedValue(anAgent()) },
    })
    useRoster.setState({
      runners: [aRunner(), aRunner({ id: 'codex', provider: 'OpenAI', auth: 'none', ready: false })],
      skills: [aSkill({ name: 'repro-harness' })],
    })
  })

  test('renders the provider cards with their auth state', async () => {
    render(<NewAgent />)

    expect(screen.getByRole('button', { name: /Anthropic/ })).toHaveTextContent('subscription')
    expect(screen.getByRole('button', { name: /OpenAI/ })).toHaveTextContent('not signed in')
  })

  test('lists the models for the chosen provider with prices', async () => {
    render(<NewAgent />)

    expect(await screen.findByText('claude-opus-5')).toBeInTheDocument()
    expect(screen.getByText('$5 / $25')).toBeInTheDocument()
  })

  test('defaults to the first model so the form is submittable', async () => {
    render(<NewAgent />)

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /claude-opus-5/ })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    )
  })

  test('Create is disabled until the agent is named', async () => {
    const user = userEvent.setup()
    render(<NewAgent />)
    await screen.findByText('claude-opus-5')

    expect(screen.getByRole('button', { name: 'Create agent' })).toBeDisabled()

    await user.type(screen.getByLabelText('Agent name'), 'Architect Agent')
    expect(screen.getByRole('button', { name: 'Create agent' })).toBeEnabled()
  })

  test('creates the agent and returns to the grid', async () => {
    const user = userEvent.setup()
    render(<NewAgent />)
    await screen.findByText('claude-opus-5')

    await user.type(screen.getByLabelText('Agent name'), 'Architect Agent')
    await user.click(screen.getByRole('button', { name: /repro-harness/ }))
    await user.click(screen.getByRole('button', { name: 'Create agent' }))

    await waitFor(() => expect(useRoster.getState().screen).toBe('grid'))
    expect(window.roster.agents.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Architect Agent', skills: ['repro-harness'] }),
    )
  })

  test('trims the name rather than creating one with padding', async () => {
    const user = userEvent.setup()
    render(<NewAgent />)
    await screen.findByText('claude-opus-5')

    await user.type(screen.getByLabelText('Agent name'), '  Padded  ')
    await user.click(screen.getByRole('button', { name: 'Create agent' }))

    await waitFor(() =>
      expect(window.roster.agents.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Padded' }),
      ),
    )
  })

  test('shows why creation failed instead of silently returning', async () => {
    const user = userEvent.setup()
    installRosterApi({
      runners: { models: vi.fn().mockResolvedValue([{ id: 'claude-opus-5', price: '' }]) },
      agents: { create: vi.fn().mockRejectedValue(new Error('EACCES: cannot write')) },
    })
    // Start where the user actually is, so "did not navigate away" means something.
    useRoster.setState({ screen: 'new' })
    render(<NewAgent />)
    await screen.findByText('claude-opus-5')

    await user.type(screen.getByLabelText('Agent name'), 'Doomed')
    await user.click(screen.getByRole('button', { name: 'Create agent' }))

    expect(await screen.findByText(/EACCES: cannot write/)).toBeInTheDocument()
    expect(useRoster.getState().screen).toBe('new')
  })

  test('Cancel returns without creating anything', async () => {
    const user = userEvent.setup()
    render(<NewAgent />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(useRoster.getState().screen).toBe('grid')
    expect(window.roster.agents.create).not.toHaveBeenCalled()
  })
})

/* --------------------------------------------------------------- edit modal */

describe('EditAgentModal', () => {
  const AGENT = anAgent({
    id: 'debugging',
    skills: ['repro-harness'],
    mcpServers: ['filesystem'],
  })

  beforeEach(() => {
    installRosterApi({
      runners: {
        models: vi.fn().mockResolvedValue([
          { id: 'claude-opus-5', price: '$5 / $25' },
          { id: 'claude-haiku-4-5', price: '$1 / $5' },
        ]),
      },
      agents: { update: vi.fn().mockResolvedValue(AGENT), list: vi.fn().mockResolvedValue([AGENT]) },
    })
    useRoster.setState({
      agents: [AGENT],
      agentId: 'debugging',
      runners: [aRunner()],
      skills: [aSkill({ name: 'repro-harness' }), aSkill({ name: 'stack-triage' })],
      mcpServers: [anMcpServer({ name: 'filesystem' }), anMcpServer({ name: 'github' })],
    })
    useRoster.getState().openEdit()
  })

  test('opens with the agent name and its config file', () => {
    render(<EditAgentModal agent={AGENT} />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Edit Debugging Agent')).toBeInTheDocument()
    expect(screen.getByText('agent.toml')).toBeInTheDocument()
  })

  test('shows the live character count for the system prompt', async () => {
    const user = userEvent.setup()
    render(<EditAgentModal agent={AGENT} />)

    await user.type(screen.getByLabelText('System prompt'), '!')

    const expected = `${AGENT.systemPrompt.length + 1} characters`
    expect(screen.getByText(expected)).toBeInTheDocument()
  })

  test('reflects which skills and servers are enabled', () => {
    render(<EditAgentModal agent={AGENT} />)

    expect(screen.getByRole('button', { name: /repro-harness/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /stack-triage/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  test('Save writes only the enabled entries back to agent.toml', async () => {
    const user = userEvent.setup()
    render(<EditAgentModal agent={AGENT} />)

    await user.click(screen.getByRole('button', { name: /stack-triage/ }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(window.roster.agents.update).toHaveBeenCalledWith(
        'debugging',
        expect.objectContaining({ skills: ['repro-harness', 'stack-triage'] }),
      ),
    )
  })

  test('Save closes the modal and discards the draft', async () => {
    const user = userEvent.setup()
    render(<EditAgentModal agent={AGENT} />)

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(useRoster.getState().editOpen).toBe(false))
    expect(useRoster.getState().draft).toBeNull()
  })

  test('Cancel discards edits without writing', async () => {
    const user = userEvent.setup()
    render(<EditAgentModal agent={AGENT} />)

    await user.type(screen.getByLabelText('System prompt'), ' changed')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(window.roster.agents.update).not.toHaveBeenCalled()
    expect(useRoster.getState().editOpen).toBe(false)
  })

  test('Escape closes it', async () => {
    const user = userEvent.setup()
    render(<EditAgentModal agent={AGENT} />)

    await user.keyboard('{Escape}')
    expect(useRoster.getState().editOpen).toBe(false)
  })

  test('surfaces a write failure rather than closing as if it worked', async () => {
    const user = userEvent.setup()
    installRosterApi({
      runners: { models: vi.fn().mockResolvedValue([{ id: 'claude-opus-5', price: '' }]) },
      agents: { update: vi.fn().mockRejectedValue(new Error('EROFS: read-only')) },
    })
    render(<EditAgentModal agent={AGENT} />)

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText(/EROFS: read-only/)).toBeInTheDocument()
    expect(useRoster.getState().editOpen).toBe(true)
  })

  test('Manage servers leaves for the MCP screen', async () => {
    const user = userEvent.setup()
    render(<EditAgentModal agent={AGENT} />)

    await user.click(screen.getByRole('button', { name: 'Manage servers' }))

    expect(useRoster.getState().screen).toBe('mcp')
    expect(useRoster.getState().editOpen).toBe(false)
  })
})

/* ------------------------------------------------- newly wired affordances */

describe('Skills — New skill and Reveal', () => {
  beforeEach(() => {
    installRosterApi({
      skills: {
        read: vi.fn().mockResolvedValue('# ADR Writer'),
        create: vi.fn().mockResolvedValue(aSkill({ name: 'new-skill', path: '/skills/new-skill' })),
        list: vi.fn().mockResolvedValue([aSkill({ name: 'adr-writer', path: '/skills/adr-writer' })]),
      },
    })
    useRoster.setState({
      skills: [aSkill({ name: 'adr-writer', path: '/skills/adr-writer' })],
      agents: [],
    })
  })

  test('New skill creates one and opens it', async () => {
    const user = userEvent.setup()
    render(<Skills />)

    await user.click(screen.getByRole('button', { name: 'New skill' }))

    await waitFor(() => expect(window.roster.skills.create).toHaveBeenCalledWith('New skill'))
    // It should land you in the new file, not leave you where you were.
    await waitFor(() =>
      expect(window.roster.skills.read).toHaveBeenCalledWith('/skills/new-skill/SKILL.md'),
    )
  })

  test('a failed creation is reported rather than swallowed', async () => {
    const user = userEvent.setup()
    installRosterApi({
      skills: {
        read: vi.fn().mockResolvedValue('# A'),
        create: vi.fn().mockRejectedValue(new Error('EACCES: read-only library')),
      },
    })
    render(<Skills />)

    await user.click(screen.getByRole('button', { name: 'New skill' }))

    expect(await screen.findByText(/EACCES: read-only library/)).toBeInTheDocument()
  })

  test('Reveal opens the folder of the skill being edited', async () => {
    const user = userEvent.setup()
    render(<Skills />)
    await screen.findByLabelText('Skill file contents')

    await user.click(screen.getByRole('button', { name: 'Reveal in Finder' }))

    expect(window.roster.skills.reveal).toHaveBeenCalledWith('adr-writer')
  })

  test('Reveal does nothing when the library is empty', async () => {
    const user = userEvent.setup()
    useRoster.setState({ skills: [] })
    render(<Skills />)

    await user.click(screen.getByRole('button', { name: 'Reveal in Finder' }))

    expect(window.roster.skills.reveal).not.toHaveBeenCalled()
  })
})

describe('McpServers — Install', () => {
  test('installing opens the editor rather than installing blind', async () => {
    const user = userEvent.setup()
    installRosterApi()
    useRoster.setState({ mcpServers: [], agents: [] })
    render(<McpServers />)

    await user.click(screen.getByRole('tab', { name: 'Registry' }))
    await user.click(screen.getAllByRole('button', { name: 'Install' })[0]!)

    // The command and its token are set before the first launch, not after
    // it has already failed once.
    const dialog = await screen.findByRole('dialog', { name: 'Configure github' })
    expect(within(dialog).getByLabelText('Launch command')).toHaveValue(
      'npx @modelcontextprotocol/server-github',
    )
    expect(window.roster.mcp.install).not.toHaveBeenCalled()
  })

  test('saving from the registry installs and then configures', async () => {
    const user = userEvent.setup()
    installRosterApi({
      mcp: { save: vi.fn().mockResolvedValue([anMcpServer({ name: 'github' })]) },
    })
    useRoster.setState({ mcpServers: [], agents: [] })
    render(<McpServers />)

    await user.click(screen.getByRole('tab', { name: 'Registry' }))
    await user.click(screen.getAllByRole('button', { name: 'Install' })[0]!)
    const dialog = await screen.findByRole('dialog', { name: 'Configure github' })
    await user.click(within(dialog).getByRole('button', { name: 'Install' }))

    // save() refuses a name it does not know, so install has to land first.
    await waitFor(() =>
      expect(window.roster.mcp.install).toHaveBeenCalledWith(
        'github',
        'npx @modelcontextprotocol/server-github',
      ),
    )
    expect(window.roster.mcp.save).toHaveBeenCalledWith(
      'github',
      'npx @modelcontextprotocol/server-github',
      {},
    )
    expect(useRoster.getState().mcpServers.map((s) => s.name)).toEqual(['github'])
  })
})

describe('WorkingDirectory picker', () => {
  const AGENT = anAgent({ id: 'debugging', cwd: '/work/api', cwdLabel: '~/work/api' })

  function openModal() {
    useRoster.setState({
      agents: [AGENT],
      agentId: 'debugging',
      runners: [aRunner()],
      skills: [],
      mcpServers: [],
    })
    useRoster.getState().openEdit()
  }

  test('a chosen directory updates the draft without touching the agent', async () => {
    const user = userEvent.setup()
    installRosterApi({
      runners: { models: vi.fn().mockResolvedValue([{ id: 'claude-opus-5', price: '' }]) },
      dialog: { chooseDirectory: vi.fn().mockResolvedValue('/work/other') },
    })
    openModal()
    render(<EditAgentModal agent={AGENT} />)

    await user.click(screen.getByRole('button', { name: 'Choose…' }))

    await waitFor(() => expect(useRoster.getState().draft?.cwd).toBe('/work/other'))
    expect(useRoster.getState().agents[0]?.cwd).toBe('/work/api')
  })

  test('cancelling the picker leaves the directory alone', async () => {
    const user = userEvent.setup()
    installRosterApi({
      runners: { models: vi.fn().mockResolvedValue([{ id: 'claude-opus-5', price: '' }]) },
      dialog: { chooseDirectory: vi.fn().mockResolvedValue(null) },
    })
    openModal()
    render(<EditAgentModal agent={AGENT} />)

    await user.click(screen.getByRole('button', { name: 'Choose…' }))

    await waitFor(() => expect(useRoster.getState().draft?.cwd).toBe('/work/api'))
  })

  test('the picker opens at the directory currently set', async () => {
    const user = userEvent.setup()
    const chooseDirectory = vi.fn().mockResolvedValue(null)
    installRosterApi({
      runners: { models: vi.fn().mockResolvedValue([{ id: 'claude-opus-5', price: '' }]) },
      dialog: { chooseDirectory },
    })
    openModal()
    render(<EditAgentModal agent={AGENT} />)

    await user.click(screen.getByRole('button', { name: 'Choose…' }))

    expect(chooseDirectory).toHaveBeenCalledWith('/work/api')
  })

  test('Save writes the chosen directory back to agent.toml', async () => {
    const user = userEvent.setup()
    installRosterApi({
      runners: { models: vi.fn().mockResolvedValue([{ id: 'claude-opus-5', price: '' }]) },
      dialog: { chooseDirectory: vi.fn().mockResolvedValue('/work/other') },
      agents: { update: vi.fn().mockResolvedValue(AGENT), list: vi.fn().mockResolvedValue([AGENT]) },
    })
    openModal()
    render(<EditAgentModal agent={AGENT} />)

    await user.click(screen.getByRole('button', { name: 'Choose…' }))
    await waitFor(() => expect(useRoster.getState().draft?.cwd).toBe('/work/other'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(window.roster.agents.update).toHaveBeenCalledWith(
        'debugging',
        expect.objectContaining({ cwd: '/work/other' }),
      ),
    )
  })
})

describe('Skills — creating files and folders', () => {
  const ADR = aSkill({ name: 'adr-writer', path: '/skills/adr-writer', files: ['SKILL.md'] })
  const REPRO = aSkill({
    name: 'repro-harness',
    path: '/skills/repro-harness',
    files: ['SKILL.md', 'templates/'],
  })

  beforeEach(() => {
    installRosterApi({
      skills: {
        read: vi.fn().mockResolvedValue('# ADR Writer'),
        list: vi.fn().mockResolvedValue([ADR, REPRO]),
        createFile: vi.fn().mockResolvedValue('/skills/adr-writer/repro.py'),
        createFolder: vi.fn().mockResolvedValue('/skills/adr-writer/templates'),
      },
    })
    useRoster.setState({ skills: [ADR, REPRO], agents: [] })
  })

  test('every skill carries its own create icons', () => {
    render(<Skills />)

    // The whole point: each skill is targetable, not just the open one.
    expect(screen.getByRole('button', { name: 'New file in adr-writer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New file in repro-harness' })).toBeInTheDocument()
  })

  test('a file row has no create icons, since nothing can go inside it', () => {
    render(<Skills />)
    expect(screen.queryByRole('button', { name: /New file in SKILL\.md/ })).not.toBeInTheDocument()
  })

  test('creates in the skill whose icon was clicked, not the open one', async () => {
    const user = userEvent.setup()
    render(<Skills />)
    // adr-writer's SKILL.md opens automatically.
    await screen.findByLabelText('Skill file contents')

    await user.click(screen.getByRole('button', { name: 'New file in repro-harness' }))
    await user.type(screen.getByLabelText('New file name'), 'triage.py{Enter}')

    await waitFor(() =>
      expect(window.roster.skills.createFile).toHaveBeenCalledWith('repro-harness', 'triage.py'),
    )
  })

  test('creating inside a folder prefixes its path', async () => {
    const user = userEvent.setup()
    render(<Skills />)

    await user.click(screen.getByRole('button', { name: 'New file in templates' }))
    await user.type(screen.getByLabelText('New file name'), 'pytest.py{Enter}')

    await waitFor(() =>
      expect(window.roster.skills.createFile).toHaveBeenCalledWith(
        'repro-harness',
        'templates/pytest.py',
      ),
    )
  })

  test('the folder icon creates a folder rather than a file', async () => {
    const user = userEvent.setup()
    render(<Skills />)

    await user.click(screen.getByRole('button', { name: 'New folder in adr-writer' }))
    await user.type(screen.getByLabelText('New folder name'), 'templates{Enter}')

    await waitFor(() =>
      expect(window.roster.skills.createFolder).toHaveBeenCalledWith('adr-writer', 'templates'),
    )
    expect(window.roster.skills.createFile).not.toHaveBeenCalled()
  })

  test('no name row appears until an icon is clicked', () => {
    render(<Skills />)
    expect(screen.queryByLabelText('New file name')).not.toBeInTheDocument()
  })

  test('the name row appears under the row it belongs to', async () => {
    const user = userEvent.setup()
    const { container } = render(<Skills />)

    await user.click(screen.getByRole('button', { name: 'New file in repro-harness' }))

    const rows = [...container.querySelectorAll('nav > *')]
    const skillIndex = rows.findIndex((r) => r.textContent?.startsWith('repro-harness'))
    const inputIndex = rows.findIndex((r) => r.querySelector('input'))

    expect(inputIndex).toBe(skillIndex + 1)
  })

  test('Escape cancels without creating anything', async () => {
    const user = userEvent.setup()
    render(<Skills />)

    await user.click(screen.getByRole('button', { name: 'New file in adr-writer' }))
    await user.type(screen.getByLabelText('New file name'), 'unwanted.md{Escape}')

    expect(screen.queryByLabelText('New file name')).not.toBeInTheDocument()
    expect(window.roster.skills.createFile).not.toHaveBeenCalled()
  })

  test('an empty name creates nothing', async () => {
    const user = userEvent.setup()
    render(<Skills />)

    await user.click(screen.getByRole('button', { name: 'New file in adr-writer' }))
    await user.type(screen.getByLabelText('New file name'), '{Enter}')

    expect(window.roster.skills.createFile).not.toHaveBeenCalled()
  })

  test('a rejected name is reported and the row stays open to fix it', async () => {
    const user = userEvent.setup()
    installRosterApi({
      skills: {
        read: vi.fn().mockResolvedValue('# A'),
        list: vi.fn().mockResolvedValue([ADR]),
        createFile: vi.fn().mockRejectedValue(new Error('"SKILL.md" already exists')),
      },
    })
    useRoster.setState({ skills: [ADR], agents: [] })
    render(<Skills />)

    await user.click(screen.getByRole('button', { name: 'New file in adr-writer' }))
    await user.type(screen.getByLabelText('New file name'), 'SKILL.md{Enter}')

    expect(await screen.findByText(/already exists/)).toBeInTheDocument()
    expect(screen.getByLabelText('New file name')).toBeInTheDocument()
  })
})

describe('Skills — the file tree', () => {
  test('shows folders as their own rows, per the handoff', () => {
    installRosterApi({ skills: { read: vi.fn().mockResolvedValue('# A') } })
    useRoster.setState({
      skills: [
        aSkill({
          name: 'repro-harness',
          path: '/skills/repro-harness',
          files: ['SKILL.md', 'templates/', 'templates/pytest.py'],
        }),
      ],
      agents: [],
    })
    const { container } = render(<Skills />)
    const tree = container.querySelector('nav')!

    expect(within(tree).getByText('templates')).toBeInTheDocument()
    // In the tree only the last segment is shown; the indent carries the rest.
    // The metadata rail still lists full paths, which is its job.
    expect(within(tree).getByText('pytest.py')).toBeInTheDocument()
    expect(within(tree).queryByText('templates/pytest.py')).not.toBeInTheDocument()
  })

  test('a folder row selects without changing the open file', async () => {
    const user = userEvent.setup()
    installRosterApi({ skills: { read: vi.fn().mockResolvedValue('# A') } })
    useRoster.setState({
      skills: [aSkill({ name: 'x', path: '/skills/x', files: ['SKILL.md', 'templates/'] })],
      agents: [],
    })
    render(<Skills />)
    await screen.findByLabelText('Skill file contents')

    await user.click(screen.getByRole('button', { name: 'templates' }))

    // Selectable so it can be deleted, but there is no file to open.
    expect(screen.getByRole('button', { name: 'templates' })).toHaveAttribute('aria-current', 'true')
    expect(window.roster.skills.read).toHaveBeenCalledTimes(1)
  })
})


describe('Skills — deleting', () => {
  const SKILL = aSkill({
    name: 'repro-harness',
    path: '/skills/repro-harness',
    files: ['SKILL.md', 'templates/', 'templates/pytest.py'],
  })

  beforeEach(() => {
    installRosterApi({
      skills: {
        read: vi.fn().mockResolvedValue('# Repro'),
        list: vi.fn().mockResolvedValue([SKILL]),
        remove: vi.fn().mockResolvedValue(true),
        removeSkill: vi.fn().mockResolvedValue(true),
      },
    })
    useRoster.setState({ skills: [SKILL], agents: [] })
  })

  test('every row carries its own delete, including files', () => {
    render(<Skills />)

    expect(screen.getByRole('button', { name: 'Delete skill repro-harness' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete templates' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete pytest.py' })).toBeInTheDocument()
  })

  test('deletes a file by its path within the skill', async () => {
    const user = userEvent.setup()
    render(<Skills />)

    await user.click(screen.getByRole('button', { name: 'Delete pytest.py' }))

    await waitFor(() =>
      expect(window.roster.skills.remove).toHaveBeenCalledWith(
        'repro-harness',
        'templates/pytest.py',
      ),
    )
  })

  test('deletes a folder', async () => {
    const user = userEvent.setup()
    render(<Skills />)

    await user.click(screen.getByRole('button', { name: 'Delete templates' }))

    await waitFor(() =>
      expect(window.roster.skills.remove).toHaveBeenCalledWith('repro-harness', 'templates/'),
    )
  })

  test('the skill row removes the whole skill, and says so', async () => {
    const user = userEvent.setup()
    render(<Skills />)

    // The label distinguishes it: deleting a skill is a bigger loss.
    await user.click(screen.getByRole('button', { name: 'Delete skill repro-harness' }))

    await waitFor(() =>
      expect(window.roster.skills.removeSkill).toHaveBeenCalledWith('repro-harness'),
    )
    expect(window.roster.skills.remove).not.toHaveBeenCalled()
  })

  test('deletes the row pressed, not whichever file is open', async () => {
    const user = userEvent.setup()
    render(<Skills />)
    // SKILL.md opens automatically.
    await screen.findByLabelText('Skill file contents')

    await user.click(screen.getByRole('button', { name: 'Delete pytest.py' }))

    await waitFor(() =>
      expect(window.roster.skills.remove).toHaveBeenCalledWith(
        'repro-harness',
        'templates/pytest.py',
      ),
    )
  })

  test('cancelling at the dialog changes nothing', async () => {
    const user = userEvent.setup()
    const list = vi.fn().mockResolvedValue([SKILL])
    installRosterApi({
      skills: {
        read: vi.fn().mockResolvedValue('# Repro'),
        list,
        // The main process reports a cancelled confirmation as false.
        remove: vi.fn().mockResolvedValue(false),
      },
    })
    render(<Skills />)

    await user.click(screen.getByRole('button', { name: 'Delete pytest.py' }))

    await waitFor(() => expect(window.roster.skills.remove).toHaveBeenCalled())
    // The tree is not reloaded and the row is still there.
    expect(list).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete pytest.py' })).toBeInTheDocument()
  })

  test('reports a failed delete rather than pretending it worked', async () => {
    const user = userEvent.setup()
    installRosterApi({
      skills: {
        read: vi.fn().mockResolvedValue('# Repro'),
        remove: vi.fn().mockRejectedValue(new Error('EPERM: operation not permitted')),
      },
    })
    render(<Skills />)

    await user.click(screen.getByRole('button', { name: 'Delete pytest.py' }))

    expect(await screen.findByText(/EPERM/)).toBeInTheDocument()
  })

  test('closes the editor when the open file is deleted', async () => {
    const user = userEvent.setup()
    // After the delete the library no longer holds that file.
    installRosterApi({
      skills: {
        read: vi.fn().mockResolvedValue('# Repro'),
        remove: vi.fn().mockResolvedValue(true),
        list: vi
          .fn()
          .mockResolvedValue([{ ...SKILL, files: ['templates/', 'templates/pytest.py'] }]),
      },
    })
    render(<Skills />)
    await screen.findByLabelText('Skill file contents')

    await user.click(screen.getByRole('button', { name: 'Delete SKILL.md' }))

    await waitFor(() => expect(screen.getByText('no file open')).toBeInTheDocument())
  })

  test('deleting an unrelated folder leaves the open file alone', async () => {
    const user = userEvent.setup()
    installRosterApi({
      skills: {
        read: vi.fn().mockResolvedValue('# Repro'),
        remove: vi.fn().mockResolvedValue(true),
        list: vi.fn().mockResolvedValue([{ ...SKILL, files: ['SKILL.md'] }]),
      },
    })
    render(<Skills />)
    await screen.findByLabelText('Skill file contents')

    // SKILL.md is open and sits outside templates/, so it must stay open.
    await user.click(screen.getByRole('button', { name: 'Delete templates' }))

    await waitFor(() => expect(window.roster.skills.remove).toHaveBeenCalled())
    expect(screen.queryByText('no file open')).not.toBeInTheDocument()
  })
})
