import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Desktop } from '../../src/screens/Desktop'
import { installRosterApi } from './rosterApi'

const report = { accessibilityTrusted: false, screenCaptureAllowed: false, inputPostingAllowed: false, visibleScreens: 0, frontmostApp: null }
describe('desktop diagnostics screen', () => {
  it('does not inspect the desktop or request permissions until clicked', async () => {
    const api = installRosterApi({ desktop: { check: vi.fn().mockResolvedValue(report) } })
    render(<Desktop />)
    expect(window.roster.desktop.requestAccessibility).not.toHaveBeenCalled()
    expect(api.desktop.check).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Run diagnostics' }))
    expect(await screen.findByText('No desktop screens are visible to this process.')).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
  })
  it('surfaces helper failures and permits retry', async () => {
    installRosterApi({ desktop: { check: vi.fn().mockRejectedValue(new Error('helper missing')) } })
    render(<Desktop />)
    expect(window.roster.desktop.requestAccessibility).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Run diagnostics' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('helper missing')
    expect(screen.getByRole('button', { name: 'Run diagnostics' })).toBeEnabled()
  })
})

it('shows pending permission instructions without claiming a grant', async () => {
  const api = installRosterApi({ desktop: { requestAccessibility: vi.fn().mockResolvedValue(undefined) } })
  render(<Desktop />)
  fireEvent.click(screen.getByRole('button', { name: 'Request Accessibility access' }))
  expect(await screen.findByText(/Approve access in System Settings/)).toBeInTheDocument()
  expect(api.desktop.check).not.toHaveBeenCalled()
})
it('shows readback and a test-window screenshot after successful native input', async () => {
  const phrase = 'Roster test 123'
  installRosterApi({ desktop: { test: vi.fn().mockResolvedValue({ expected: phrase, observed: phrase, screenshot: 'data:image/png;base64,abc' }) } })
  render(<Desktop />)
  fireEvent.click(screen.getByRole('button', { name: 'Run local control test' }))
  expect(await screen.findByText('Local keyboard control verified')).toBeInTheDocument()
  expect(screen.getByText(phrase)).toBeInTheDocument()
  expect(screen.getByAltText('Disposable test window after native keyboard input')).toHaveAttribute('src', 'data:image/png;base64,abc')
})
