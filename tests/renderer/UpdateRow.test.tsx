import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { UpdateRow } from '@/components/UpdateRow'
import { useRoster } from '@/state/store'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  installRosterApi()
})

describe('UpdateRow — when it stays out of the way', () => {
  test('shows nothing before any check has run', () => {
    const { container } = render(<UpdateRow />)

    expect(container).toBeEmptyDOMElement()
  })

  test('shows nothing when the app is already current', () => {
    useRoster.setState({ update: { status: 'current' } })
    const { container } = render(<UpdateRow />)

    expect(container).toBeEmptyDOMElement()
  })

  test('stays silent while checking, so it does not flicker on every launch', () => {
    useRoster.setState({ update: { status: 'checking' } })
    const { container } = render(<UpdateRow />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('UpdateRow — offering an update', () => {
  test('names the version on offer', () => {
    useRoster.setState({
      update: { status: 'available', version: '0.1.2', notes: '', url: 'https://example.test' },
    })
    render(<UpdateRow />)

    expect(screen.getByText('Version 0.1.2 available')).toBeInTheDocument()
  })

  test('Download asks main to fetch the build', async () => {
    const api = installRosterApi()
    useRoster.setState({
      update: { status: 'available', version: '0.1.2', notes: '', url: 'https://example.test' },
    })
    render(<UpdateRow />)

    await userEvent.click(screen.getByRole('button', { name: 'Download' }))

    expect(api.update.download).toHaveBeenCalled()
  })
})

describe('UpdateRow — downloading', () => {
  test('reports how far along it is', () => {
    useRoster.setState({ update: { status: 'downloading', version: '0.1.2', percent: 62 } })
    render(<UpdateRow />)

    expect(screen.getByText('Downloading 0.1.2… 62%')).toBeInTheDocument()
  })

  test('offers no button mid-download, so it cannot be started twice', () => {
    useRoster.setState({ update: { status: 'downloading', version: '0.1.2', percent: 62 } })
    render(<UpdateRow />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('UpdateRow — ready to install', () => {
  test('opens the installer and says what to do with it', async () => {
    const api = installRosterApi()
    useRoster.setState({
      update: { status: 'ready', version: '0.1.2', path: '/Users/test/Downloads/Roster.dmg' },
    })
    render(<UpdateRow />)

    expect(screen.getByText('0.1.2 ready to install')).toBeInTheDocument()
    // The app is unsigned, so it cannot replace itself — the user must drag it.
    expect(screen.getByText(/Drag Roster to Applications/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Open installer' }))

    expect(api.update.install).toHaveBeenCalled()
  })
})

describe('UpdateRow — failure', () => {
  test('shows what went wrong and offers a retry', async () => {
    const api = installRosterApi()
    useRoster.setState({ update: { status: 'error', message: 'GitHub answered 503' } })
    render(<UpdateRow />)

    expect(screen.getByText('GitHub answered 503')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(api.update.check).toHaveBeenCalled()
  })
})
