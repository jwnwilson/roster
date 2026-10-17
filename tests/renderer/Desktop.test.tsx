import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Desktop } from '../../src/screens/Desktop'
import { installRosterApi } from './rosterApi'

const report = { accessibilityTrusted: false, screenCaptureAllowed: false, inputPostingAllowed: false, visibleScreens: 0, frontmostApp: null }
describe('desktop diagnostics screen', () => {
  it('does not inspect the desktop or request permissions until clicked', async () => {
    const api = installRosterApi({ desktop: { check: vi.fn().mockResolvedValue(report) } })
    render(<Desktop />)
    expect(screen.queryByRole('button', { name: /Request/ })).not.toBeInTheDocument()
    expect(api.desktop.check).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Run diagnostics' }))
    expect(await screen.findByText('No desktop screens are visible to this process.')).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
  })
  it('surfaces helper failures and permits retry', async () => {
    installRosterApi({ desktop: { check: vi.fn().mockRejectedValue(new Error('helper missing')) } })
    render(<Desktop />)
    expect(screen.queryByRole('button', { name: /Request/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run diagnostics' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('helper missing')
    expect(screen.getByRole('button', { name: 'Run diagnostics' })).toBeEnabled()
  })
})
