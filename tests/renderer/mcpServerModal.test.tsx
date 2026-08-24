import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { McpServers } from '@/screens/McpServers'
import { useRoster } from '@/state/store'
import { anAgent, anMcpServer } from './factories'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()

function withServers(env: Record<string, string> = {}) {
  useRoster.setState(INITIAL, true)
  useRoster.setState({
    screen: 'mcp',
    mcpServers: [anMcpServer({ name: 'github', command: 'npx server-github', env })],
    agents: [anAgent({ id: 'debugging', name: 'Debugging Agent', mcpServers: [] })],
  })
}

async function openEditor() {
  const user = userEvent.setup()
  render(<McpServers />)
  await user.click(screen.getByRole('button', { name: 'Configure github' }))
  return { user, dialog: await screen.findByRole('dialog', { name: 'Configure github' }) }
}

beforeEach(() => {
  installRosterApi()
  withServers()
})

describe('McpServerModal — opening', () => {
  test('clicking an installed server opens its editor', async () => {
    const { dialog } = await openEditor()

    expect(within(dialog).getByLabelText('Launch command')).toHaveValue('npx server-github')
  })

  test('shows the environment already configured', async () => {
    withServers({ GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_secret' })
    const { dialog } = await openEditor()

    expect(within(dialog).getByLabelText('Variable 1 name')).toHaveValue(
      'GITHUB_PERSONAL_ACCESS_TOKEN',
    )
    expect(within(dialog).getByLabelText('Variable 1 value')).toHaveValue('ghp_secret')
  })

  test('says the environment is empty rather than showing a blank area', async () => {
    const { dialog } = await openEditor()

    expect(within(dialog).getByText(/No variables/)).toBeInTheDocument()
  })

  test('closes without saving on Cancel', async () => {
    const { user, dialog } = await openEditor()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(window.roster.mcp.save).not.toHaveBeenCalled()
  })
})

describe('McpServerModal — saving', () => {
  test('writes the edited command', async () => {
    const { user, dialog } = await openEditor()
    const command = within(dialog).getByLabelText('Launch command')

    await user.clear(command)
    await user.type(command, 'docker run ghcr.io/github/github-mcp-server')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(window.roster.mcp.save).toHaveBeenCalledWith(
        'github',
        'docker run ghcr.io/github/github-mcp-server',
        {},
      ),
    )
  })

  test('writes an added variable, which is what a token needs', async () => {
    const { user, dialog } = await openEditor()

    await user.click(within(dialog).getByRole('button', { name: 'Add variable' }))
    await user.type(within(dialog).getByLabelText('Variable 1 name'), 'GITHUB_TOKEN')
    await user.type(within(dialog).getByLabelText('Variable 1 value'), 'ghp_abc')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(window.roster.mcp.save).toHaveBeenCalledWith('github', 'npx server-github', {
        GITHUB_TOKEN: 'ghp_abc',
      }),
    )
  })

  test('removes a variable', async () => {
    withServers({ OLD: 'value' })
    const { user, dialog } = await openEditor()

    await user.click(within(dialog).getByRole('button', { name: 'Remove variable 1' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(window.roster.mcp.save).toHaveBeenCalledWith('github', 'npx server-github', {}))
  })

  test('drops a row whose name was never filled in', async () => {
    const { user, dialog } = await openEditor()

    await user.click(within(dialog).getByRole('button', { name: 'Add variable' }))
    await user.type(within(dialog).getByLabelText('Variable 1 value'), 'orphan')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    // An empty key would be written as "" and passed to the process.
    await waitFor(() =>
      expect(window.roster.mcp.save).toHaveBeenCalledWith('github', 'npx server-github', {}),
    )
  })

  test('will not save an empty command', async () => {
    const { user, dialog } = await openEditor()

    await user.clear(within(dialog).getByLabelText('Launch command'))

    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  test('reports a failure instead of closing on it', async () => {
    installRosterApi({
      mcp: { save: vi.fn().mockRejectedValue(new Error('unknown MCP server "github"')) },
    })
    withServers()
    const { user, dialog } = await openEditor()

    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await within(dialog).findByText('unknown MCP server "github"')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('warns that the environment is stored in the clear', async () => {
    const { dialog } = await openEditor()

    // These are tokens; the user should know where they land.
    expect(within(dialog).getByText(/plain text in mcp.json/)).toBeInTheDocument()
  })
})

describe('McpServers — the whole card is the target', () => {
  // The card is made clickable by stretching the button's hit area over it
  // with an ::after overlay. jsdom does no layout, so nothing here can prove
  // the overlay actually catches a click on the card's padding — that part is
  // verified against the running app. What these do check is that stretching
  // it did not break the pieces jsdom can see.

  test('the command text opens the editor', async () => {
    const user = userEvent.setup()
    render(<McpServers />)

    await user.click(screen.getByText('npx server-github'))

    expect(await screen.findByRole('dialog', { name: 'Configure github' })).toBeInTheDocument()
  })

  test('the overlay is declared on the button, not left to the card', () => {
    render(<McpServers />)
    const button = screen.getByRole('button', { name: 'Configure github' })

    // If this class is lost the card silently shrinks back to a text target.
    expect(button.className).toContain('after:absolute')
    expect(button.className).toContain('after:inset-0')
  })

  test('the chips are layered above the overlay', () => {
    render(<McpServers />)
    const chip = screen.getByRole('button', { name: 'Debugging' })

    // Without the raised stacking context the overlay would swallow them.
    expect(chip.parentElement?.className).toContain('z-[1]')
  })

  test('the agent chips still toggle rather than opening the editor', async () => {
    const user = userEvent.setup()
    render(<McpServers />)

    // They are layered above the stretched area; if that broke, this click
    // would open the dialog instead.
    await user.click(screen.getByRole('button', { name: 'Debugging' }))

    expect(window.roster.mcp.setEnabled).toHaveBeenCalledWith('github', 'debugging', true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('a registry card carries the same overlay', async () => {
    const user = userEvent.setup()
    render(<McpServers />)
    await user.click(screen.getByRole('tab', { name: 'Registry' }))

    expect(screen.getByRole('button', { name: 'Configure gitlab' }).className).toContain(
      'after:absolute',
    )
  })

  test('the card still exposes one named control for the keyboard', async () => {
    render(<McpServers />)

    // Stretching the hit area must not cost the button its accessible name.
    expect(screen.getByRole('button', { name: 'Configure github' })).toBeInTheDocument()
  })
})
