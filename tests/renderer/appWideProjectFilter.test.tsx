import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { Sidebar } from '@/components/Sidebar'
import { AgentsGrid } from '@/screens/AgentsGrid'
import { Backlog } from '@/screens/Backlog'
import { Tasks } from '@/screens/Tasks'
import { useRoster } from '@/state/store'
import { aProject, aTask } from './factories'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  useRoster.setState({
    projects: [aProject({ id: 'p1', name: 'API reliability' })],
    tasks: [aTask({ id: 'ROS-1', title: 'Add concurrent index', status: 'todo' })],
    loaded: true,
  })
  installRosterApi()
})

const FILTER = 'Filter by project'

describe('the project filter is app-wide', () => {
  test('sits at the very top of the sidebar, above the navigation', () => {
    render(<Sidebar />)

    const rail = screen.getByRole('navigation')
    const first = rail.firstElementChild

    expect(first).not.toBeNull()
    expect(within(first as HTMLElement).getByLabelText(FILTER)).toBeInTheDocument()
  })

  test('the sidebar is the only place it appears', () => {
    render(
      <>
        <Sidebar />
        <Tasks />
      </>,
    )

    expect(screen.getAllByLabelText(FILTER)).toHaveLength(1)
    expect(within(screen.getByRole('navigation')).getByLabelText(FILTER)).toBeInTheDocument()
  })

  test('the agents grid does not carry its own copy', () => {
    render(
      <>
        <Sidebar />
        <AgentsGrid />
      </>,
    )

    expect(screen.getAllByLabelText(FILTER)).toHaveLength(1)
  })

  test('the backlog does not carry its own copy', () => {
    render(
      <>
        <Sidebar />
        <Backlog />
      </>,
    )

    expect(screen.getAllByLabelText(FILTER)).toHaveLength(1)
  })
})
