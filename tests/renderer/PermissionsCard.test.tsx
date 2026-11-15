import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { PermissionReport } from '@shared/permissions'
import type { SetupState } from '@shared/types'
import { PermissionsCard } from '@/components/PermissionsCard'
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
})
