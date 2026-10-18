import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { McpServers } from '../../src/screens/McpServers'
import { Sidebar } from '../../src/components/Sidebar'
import { useRoster } from '../../src/state/store'
import { installRosterApi } from './rosterApi'

it('keeps desktop access inside MCP servers even without any installed servers', () => {
  const api = installRosterApi()
  useRoster.setState({ screen: 'mcp', mcpTab: 'installed', mcpServers: [], agents: [] })
  render(<><Sidebar /><McpServers /></>)
  expect(within(screen.getByRole('navigation')).queryByRole('button', { name: 'Desktop' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: 'Desktop' }))
  expect(screen.getByRole('button', { name: 'Run local control test' })).toBeInTheDocument()
  expect(api.desktop.check).not.toHaveBeenCalled()
  expect(api.desktop.requestAccessibility).not.toHaveBeenCalled()
  expect(api.desktop.test).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('tab', { name: 'Registry' }))
  expect(screen.queryByRole('button', { name: 'Run local control test' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Configure github' })).toBeInTheDocument()
})
