import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { PermissionReport } from '@shared/permissions'
import type { SetupState } from '@shared/types'
import { PermissionsCard, type ShellRow } from '@/components/PermissionsCard'
import { useRoster } from '@/state/store'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()

const NOT_YET: PermissionReport = {
  screen: 'denied',
  accessibility: 'denied',
  microphone: 'not-determined',
}

function aSetupState(overrides: Partial<SetupState> = {}): SetupState {
  return {
    pending: false,
    startingAgentId: 'tech-lead',
    seededAgentIds: ['tech-lead'],
    noRunner: false,
    permissionsReviewed: false,
    ...overrides,
  }
}

beforeEach(() => {
  useRoster.setState(INITIAL, true)
})

function mount(report: PermissionReport, setup: SetupState = aSetupState()) {
  const api = installRosterApi({
    permissions: {
      status: vi.fn().mockResolvedValue(report),
      request: vi.fn().mockResolvedValue(report),
      openSettings: vi.fn().mockResolvedValue(undefined),
    },
    setup: {
      reviewPermissions: vi.fn().mockResolvedValue({ ...setup, permissionsReviewed: true }),
    },
  })
  useRoster.setState({ setup })
  const view = render(<PermissionsCard />)
  return { ...view, api }
}

describe('PermissionsCard', () => {
  test('says nothing once the permissions have been reviewed', () => {
    const { container, api } = mount(NOT_YET, aSetupState({ permissionsReviewed: true }))

    expect(container).toBeEmptyDOMElement()
    expect(api.permissions.status).not.toHaveBeenCalled()
  })

  test('names each permission with what it is for and its status', async () => {
    mount(NOT_YET)

    expect(await screen.findByText('Screen Recording')).toBeInTheDocument()
    expect(screen.getByText('Accessibility')).toBeInTheDocument()
    expect(screen.getByText('Microphone')).toBeInTheDocument()
    expect(screen.getByText(/screencapture/i)).toBeInTheDocument()
  })

  test('offers to allow a permission that has not been asked for yet', async () => {
    const { api } = mount(NOT_YET)
    await userEvent.click(await screen.findByRole('button', { name: 'Allow Microphone' }))

    expect(api.permissions.request).toHaveBeenCalledWith('microphone')
  })

  test('offers System Settings for a permission that was refused', async () => {
    const { api } = mount(NOT_YET)
    await userEvent.click(await screen.findByRole('button', { name: 'Open Screen Recording settings' }))

    expect(api.permissions.openSettings).toHaveBeenCalledWith('screen')
  })

  test('tells the user Screen Recording needs a restart before it takes effect', async () => {
    mount(NOT_YET)

    expect(await screen.findByText(/restart roster after granting screen recording/i)).toBeInTheDocument()
  })

  test('puts the card away when the user is done, and records that', async () => {
    const { api } = mount(NOT_YET)
    await userEvent.click(await screen.findByRole('button', { name: 'Done' }))

    await waitFor(() => expect(api.setup.reviewPermissions).toHaveBeenCalledOnce())
    expect(useRoster.getState().setup?.permissionsReviewed).toBe(true)
  })

  test('puts itself away without a click once Screen Recording is granted, optional ones aside', async () => {
    // Screen Recording is the one a session cannot work without; Accessibility
    // and Microphone are for particular features, so refusing them should not
    // keep the card on screen.
    const { api, container } = mount({ screen: 'granted', accessibility: 'denied', microphone: 'denied' })

    await waitFor(() => expect(api.setup.reviewPermissions).toHaveBeenCalledOnce())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  describe('shell commands row', () => {
    function mountWithShell(shell: Partial<ShellRow>) {
      const onEdit = vi.fn()
      const view = render(<PermissionsCard shell={{ agentName: 'Tech Lead', runner: 'claude', allowShell: false, autoApprove: false, onEdit, ...shell }} />)
      return { ...view, onEdit }
    }

    beforeEach(() => {
      installRosterApi({
        permissions: {
          status: vi.fn().mockResolvedValue(NOT_YET),
          request: vi.fn().mockResolvedValue(NOT_YET),
          openSettings: vi.fn().mockResolvedValue(undefined),
        },
        setup: { reviewPermissions: vi.fn().mockResolvedValue(aSetupState({ permissionsReviewed: true })) },
      })
      useRoster.setState({ setup: aSetupState() })
    })

    test('says shell commands ask first by default', async () => {
      mountWithShell({})
      expect(await screen.findByText('Shell commands')).toBeInTheDocument()
      expect(screen.getByText('Asks first')).toBeInTheDocument()
    })

    test('says shell commands are allowed when the agent allows shell', async () => {
      mountWithShell({ allowShell: true })
      expect(await screen.findByText('Allowed')).toBeInTheDocument()
    })

    test('says shell commands are allowed when the agent runs every tool without asking', async () => {
      mountWithShell({ autoApprove: true })
      expect(await screen.findByText('Allowed')).toBeInTheDocument()
    })

    test('names the agent whose setting this is', async () => {
      mountWithShell({})
      expect(await screen.findByText(/tech lead/i)).toBeInTheDocument()
    })

    test('opens the agent editor from the row', async () => {
      const { onEdit } = mountWithShell({})
      await userEvent.click(await screen.findByRole('button', { name: 'Change shell commands for Tech Lead' }))
      expect(onEdit).toHaveBeenCalledOnce()
    })

    test('says Codex sandboxes its own shell, so the setting does not apply', async () => {
      mountWithShell({ runner: 'codex' })
      expect(await screen.findByText(/codex runs shell commands inside its own sandbox/i)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /change shell commands/i })).toBeNull()
    })

    test('is not shown once the permissions have been reviewed', () => {
      useRoster.setState({ setup: aSetupState({ permissionsReviewed: true }) })
      render(<PermissionsCard shell={{ agentName: 'Tech Lead', runner: 'claude', allowShell: false, autoApprove: false, onEdit: vi.fn() }} />)
      expect(screen.queryByText('Shell commands')).toBeNull()
    })
  })
})

