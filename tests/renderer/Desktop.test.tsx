import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Desktop } from '../../src/screens/Desktop'
import { installRosterApi } from './rosterApi'

const report = { accessibilityTrusted: false, screenCaptureAllowed: false, inputPostingAllowed: false, visibleScreens: 0, frontmostApp: null }
describe('desktop diagnostics screen', () => {
  it('does not inspect the desktop or request permissions until clicked', async () => {
    const api = installRosterApi({ desktop: { check: vi.fn().mockResolvedValue(report) } })
    render(<Desktop />)
    expect(api.desktop.check).not.toHaveBeenCalled()
    expect(api.desktop.request).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Run diagnostics' }))
    expect(await screen.findByText('No desktop screens are visible to this process.')).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(api.desktop.request).not.toHaveBeenCalled()
  })
  it('requests a specific permission and allows a subsequent check', async () => {
    const api = installRosterApi({ desktop: { check: vi.fn().mockResolvedValue(report), request: vi.fn().mockResolvedValue({ ...report, accessibilityTrusted: true }) } })
    render(<Desktop />)
    fireEvent.click(screen.getByRole('button', { name: 'Run diagnostics' }))
    await screen.findByText('Unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Request Accessibility access' }))
    await waitFor(() => expect(api.desktop.request).toHaveBeenCalledWith('accessibility'))
    expect(await screen.findByText('Granted')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Request Screen Recording access' }))
    await waitFor(() => expect(api.desktop.request).toHaveBeenCalledWith('screen'))
  })
  it('surfaces helper failures and permits retry', async () => {
    installRosterApi({ desktop: { check: vi.fn().mockRejectedValue(new Error('helper missing')) } })
    render(<Desktop />)
    fireEvent.click(screen.getByRole('button', { name: 'Run diagnostics' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('helper missing')
    expect(screen.getByRole('button', { name: 'Run diagnostics' })).toBeEnabled()
  })
})
