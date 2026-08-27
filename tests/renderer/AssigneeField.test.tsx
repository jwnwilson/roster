import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { AssigneeField } from '@/components/AssigneeField'
import { anAgent } from './factories'

const AGENTS = [
  anAgent({ id: 'architect', name: 'Architect Agent' }),
  anAgent({ id: 'debugging', name: 'Debugging Agent' }),
  anAgent({ id: 'review', name: 'Review Agent' }),
]

const STATUSES = { architect: 'idle', debugging: 'running', review: 'done' } as const

function setup(value: string | null = null) {
  const onChange = vi.fn()
  render(
    <AssigneeField
      agents={AGENTS}
      value={value}
      onChange={onChange}
      statuses={STATUSES}
    />,
  )
  return { onChange, field: screen.getByLabelText('Assignee') }
}

describe('AssigneeField — what it shows', () => {
  test('reads as unassigned when nobody has it', () => {
    const { field } = setup()

    expect(field).toHaveValue('')
    expect(field).toHaveAttribute('placeholder', 'Unassigned')
  })

  test('names the assignee when someone has it', () => {
    const { field } = setup('debugging')
    expect(field).toHaveValue('Debugging Agent')
  })

  test('is a combobox, closed until you touch it', () => {
    const { field } = setup()

    expect(field).toHaveAttribute('role', 'combobox')
    expect(field).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('AssigneeField — the suggestion list', () => {
  test('opens on focus, offering every agent plus Unassigned', async () => {
    const user = userEvent.setup()
    const { field } = setup()

    await user.click(field)

    expect(field).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Unassigned',
      'Architect Agent',
      'Debugging Agent',
      'Review Agent',
    ])
  })

  test('filters by what you type', async () => {
    const user = userEvent.setup()
    const { field } = setup()

    await user.click(field)
    await user.keyboard('review')

    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Review Agent'])
  })

  test('matches case-insensitively', async () => {
    const user = userEvent.setup()
    const { field } = setup()

    await user.click(field)
    await user.keyboard('DEBUG')

    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  test('says so when nothing matches, rather than showing an empty box', async () => {
    const user = userEvent.setup()
    const { field } = setup()

    await user.click(field)
    await user.keyboard('zzz')

    expect(screen.getByText('No agent matches.')).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  test('picking one assigns it and closes the list', async () => {
    const user = userEvent.setup()
    const { onChange, field } = setup()

    await user.click(field)
    await user.click(screen.getByRole('option', { name: /Review Agent/ }))

    expect(onChange).toHaveBeenCalledWith('review')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  test('picking Unassigned clears it', async () => {
    const user = userEvent.setup()
    const { onChange, field } = setup('debugging')

    await user.click(field)
    await user.click(screen.getByRole('option', { name: /Unassigned/ }))

    expect(onChange).toHaveBeenCalledWith(null)
  })

  test('still offers everyone when somebody is already assigned', async () => {
    const user = userEvent.setup()
    const { field } = setup('debugging')

    await user.click(field)

    // Pre-filling the query with the assignee's name would filter the list
    // down to that one agent, hiding Unassigned and everybody else.
    expect(screen.getAllByRole('option')).toHaveLength(4)
  })

  test('goes back to naming the assignee once it closes', async () => {
    const user = userEvent.setup()
    const { field } = setup('debugging')

    await user.click(field)
    await user.keyboard('{Escape}')

    expect(field).toHaveValue('Debugging Agent')
  })
})

describe('AssigneeField — the keyboard', () => {
  test('arrows move through the list and Enter picks', async () => {
    const user = userEvent.setup()
    const { onChange, field } = setup()

    await user.click(field)
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    // Unassigned, Architect, Debugging — two steps down from the first.
    expect(onChange).toHaveBeenCalledWith('debugging')
  })

  test('arrowing up from the top wraps to the bottom', async () => {
    const user = userEvent.setup()
    const { onChange, field } = setup()

    await user.click(field)
    await user.keyboard('{ArrowUp}{Enter}')

    expect(onChange).toHaveBeenCalledWith('review')
  })

  test('Escape closes the list without assigning anything', async () => {
    const user = userEvent.setup()
    const { onChange, field } = setup()

    await user.click(field)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  test('marks which suggestion is active for a screen reader', async () => {
    const user = userEvent.setup()
    const { field } = setup()

    await user.click(field)
    await user.keyboard('{ArrowDown}')

    const selected = screen.getAllByRole('option').filter(
      (o) => o.getAttribute('aria-selected') === 'true',
    )
    expect(selected).toHaveLength(1)
    expect(selected[0]?.textContent).toBe('Architect Agent')
  })
})

describe('AssigneeField — the clear button', () => {
  test('appears only once somebody is assigned', () => {
    setup()
    expect(screen.queryByLabelText('Clear assignee')).not.toBeInTheDocument()

    render(
      <AssigneeField agents={AGENTS} value="review" onChange={vi.fn()} statuses={STATUSES} />,
    )
    expect(screen.getByLabelText('Clear assignee')).toBeInTheDocument()
  })

  test('clearing unassigns', async () => {
    const user = userEvent.setup()
    const { onChange } = setup('review')

    await user.click(screen.getByLabelText('Clear assignee'))

    expect(onChange).toHaveBeenCalledWith(null)
  })
})
