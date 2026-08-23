import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { EditAgentModal } from '@/screens/EditAgentModal'
import { McpServers } from '@/screens/McpServers'
import { NewAgent } from '@/screens/NewAgent'
import { Skills, relativeTime } from '@/screens/Skills'
import { Sidebar } from '@/components/Sidebar'
import { useRoster } from '@/state/store'
import { anAgent, aRunner, aSkill, anMcpServer } from './factories'
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

  test('Tasks and Spend remain disabled placeholders', () => {
    render(<Sidebar />)

    expect(screen.getByRole('button', { name: /Tasks/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Spend/ })).toBeDisabled()
    expect(screen.getAllByText('soon')).toHaveLength(2)
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

describe('McpServers', () => {
  beforeEach(() => {
    useRoster.setState({
      mcpServers: [
        anMcpServer({ name: 'filesystem', enabledFor: ['debugging'] }),
        anMcpServer({ name: 'github', command: 'npx server-github', enabledFor: [] }),
      ],
      agents: [anAgent({ id: 'debugging', name: 'Debugging Agent' })],
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

  test('the registry tab groups servers by category', async () => {
    const user = userEvent.setup()
    render(<McpServers />)

    await user.click(screen.getByRole('tab', { name: 'Registry' }))

    expect(screen.getByText('gitlab')).toBeInTheDocument()
    expect(screen.getByText('notion')).toBeInTheDocument()
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
  test('installs a registry entry and shows it as installed', async () => {
    const user = userEvent.setup()
    installRosterApi({
      mcp: {
        install: vi.fn().mockResolvedValue([anMcpServer({ name: 'gitlab', enabledFor: [] })]),
      },
    })
    useRoster.setState({ mcpServers: [], agents: [] })
    render(<McpServers />)

    await user.click(screen.getByRole('tab', { name: 'Registry' }))
    await user.click(screen.getAllByRole('button', { name: 'Install' })[0]!)

    await waitFor(() =>
      expect(window.roster.mcp.install).toHaveBeenCalledWith(
        'github',
        'npx @modelcontextprotocol/server-github',
      ),
    )
    expect(useRoster.getState().mcpServers.map((s) => s.name)).toEqual(['gitlab'])
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
