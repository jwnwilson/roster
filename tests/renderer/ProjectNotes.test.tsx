import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ProjectsModal } from '@/screens/ProjectsModal'
import { useRoster } from '@/state/store'
import { aProject } from './factories'
import { installRosterApi } from './rosterApi'

/**
 * The project's NOTES.md, edited in the app.
 *
 * Reached from the Projects modal, because that is where projects already
 * live, and drawn with the same editor the Skills screen uses rather than a
 * second one.
 */

const INITIAL = useRoster.getState()

const PROJECTS = [
  aProject({ id: 'p1', name: 'API reliability', description: 'Close out bugs.' }),
  aProject({ id: 'p2', name: 'Q3 planning', description: 'Break the roadmap down.' }),
]

const NOTES = '# Project notes\n\n- 2026-09-05 Debugging Agent: release() double-frees.\n'

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  useRoster.setState({ projects: PROJECTS, projectsOpen: true })
  installRosterApi()
})

/** Opens the notes editor for the first project. */
async function openNotes(): Promise<void> {
  const user = userEvent.setup()
  const buttons = screen.getAllByRole('button', { name: 'Notes' })
  await user.click(buttons[0] as HTMLElement)
  await screen.findByLabelText('Project notes')
}

describe('the project notes editor', () => {
  test('opens the notes of the project whose button was pressed', async () => {
    const api = installRosterApi({
      projects: { readNotes: vi.fn().mockResolvedValue(NOTES) },
    })
    render(<ProjectsModal />)

    await openNotes()

    expect(api.projects.readNotes).toHaveBeenCalledWith('p1')
    expect(screen.getByLabelText('Project notes')).toHaveValue(NOTES)
  })

  test('says which file is open, so it can be found on disk', async () => {
    installRosterApi({ projects: { readNotes: vi.fn().mockResolvedValue(NOTES) } })
    render(<ProjectsModal />)

    await openNotes()

    expect(screen.getByText('API reliability / NOTES.md')).toBeInTheDocument()
  })

  test('marks the file unsaved once edited, and Save clears it', async () => {
    const user = userEvent.setup()
    const api = installRosterApi({
      projects: {
        readNotes: vi.fn().mockResolvedValue(NOTES),
        writeNotes: vi.fn().mockResolvedValue(undefined),
      },
    })
    render(<ProjectsModal />)
    await openNotes()

    await user.type(screen.getByLabelText('Project notes'), 'x')
    expect(screen.getByText('unsaved')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByText('unsaved')).not.toBeInTheDocument())
    expect(api.projects.writeNotes).toHaveBeenCalledWith('p1', `${NOTES}x`)
  })

  test('Revert puts back what is on disk', async () => {
    const user = userEvent.setup()
    installRosterApi({ projects: { readNotes: vi.fn().mockResolvedValue(NOTES) } })
    render(<ProjectsModal />)
    await openNotes()

    await user.type(screen.getByLabelText('Project notes'), 'x')
    await user.click(screen.getByRole('button', { name: 'Revert' }))

    expect(screen.getByLabelText('Project notes')).toHaveValue(NOTES)
  })

  test('goes back to the list without saving', async () => {
    const user = userEvent.setup()
    installRosterApi({ projects: { readNotes: vi.fn().mockResolvedValue(NOTES) } })
    render(<ProjectsModal />)
    await openNotes()

    await user.click(screen.getByRole('button', { name: 'Back to projects' }))

    expect(screen.getByText('Q3 planning')).toBeInTheDocument()
    expect(screen.queryByLabelText('Project notes')).not.toBeInTheDocument()
  })

  test('reports a file it could not read rather than showing an empty one', async () => {
    installRosterApi({
      projects: { readNotes: vi.fn().mockRejectedValue(new Error('permission denied')) },
    })
    render(<ProjectsModal />)

    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: 'Notes' })[0] as HTMLElement)

    expect(await screen.findByText('permission denied')).toBeInTheDocument()
  })
})

describe('the notes editor while an agent is writing', () => {
  test('shows a line an agent just remembered', async () => {
    let publish: ((payload: { projectId: string; notes: string }) => void) | null = null
    installRosterApi({
      projects: {
        readNotes: vi.fn().mockResolvedValue(NOTES),
        onNotesChanged: vi.fn().mockImplementation((listener) => {
          publish = listener as typeof publish
          return () => {}
        }),
      },
    })
    render(<ProjectsModal />)
    await openNotes()

    const appended = `${NOTES}- 2026-09-05 Review Agent: one pool per process.\n`
    act(() => publish?.({ projectId: 'p1', notes: appended }))

    expect(screen.getByLabelText('Project notes')).toHaveValue(appended)
  })

  test('does not throw away what you are in the middle of typing', async () => {
    const user = userEvent.setup()
    let publish: ((payload: { projectId: string; notes: string }) => void) | null = null
    installRosterApi({
      projects: {
        readNotes: vi.fn().mockResolvedValue(NOTES),
        onNotesChanged: vi.fn().mockImplementation((listener) => {
          publish = listener as typeof publish
          return () => {}
        }),
      },
    })
    render(<ProjectsModal />)
    await openNotes()

    await user.type(screen.getByLabelText('Project notes'), 'mine')
    act(() => publish?.({ projectId: 'p1', notes: `${NOTES}theirs\n` }))

    // Two writers, and the one at the keyboard wins their own draft.
    expect(screen.getByLabelText('Project notes')).toHaveValue(`${NOTES}mine`)
  })

  test('ignores a change to another project entirely', async () => {
    let publish: ((payload: { projectId: string; notes: string }) => void) | null = null
    installRosterApi({
      projects: {
        readNotes: vi.fn().mockResolvedValue(NOTES),
        onNotesChanged: vi.fn().mockImplementation((listener) => {
          publish = listener as typeof publish
          return () => {}
        }),
      },
    })
    render(<ProjectsModal />)
    await openNotes()

    act(() => publish?.({ projectId: 'p2', notes: 'somebody else’s notes' }))

    expect(screen.getByLabelText('Project notes')).toHaveValue(NOTES)
  })
})
