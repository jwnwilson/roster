import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { useState } from 'react'
import { MentionInput } from '@/components/MentionInput'
import { anAgent } from './factories'

const AGENTS = [
  anAgent({ id: 'tech-lead', name: 'Tech Lead' }),
  anAgent({ id: 'debugging', name: 'Debugging Agent' }),
]

/** Controlled by a host, as the thread controls it. */
function Host({ onSubmit = () => {} }: { onSubmit?: () => void }) {
  const [value, setValue] = useState('')
  return (
    <MentionInput
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      agents={AGENTS}
      statuses={{ 'tech-lead': 'idle', debugging: 'running' }}
      ariaLabel="Add a comment"
      placeholder="Add a comment"
    />
  )
}

describe('MentionInput', () => {
  test('offers the roster once an @ is typed', async () => {
    const user = userEvent.setup()
    render(<Host />)

    await user.type(screen.getByRole('combobox', { name: 'Add a comment' }), 'ask @')

    expect(screen.getByRole('option', { name: /Tech Lead/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Debugging Agent/ })).toBeInTheDocument()
  })

  test('offers nothing until there is an @ to complete', () => {
    render(<Host />)

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  test('narrows the list by id', async () => {
    const user = userEvent.setup()
    render(<Host />)

    await user.type(screen.getByRole('combobox', { name: 'Add a comment' }), '@tech')

    expect(screen.getByRole('option', { name: /Tech Lead/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Debugging Agent/ })).not.toBeInTheDocument()
  })

  test('narrows the list by name too, since the id is not what you remember', async () => {
    const user = userEvent.setup()
    render(<Host />)

    await user.type(screen.getByRole('combobox', { name: 'Add a comment' }), '@lead')

    expect(screen.getByRole('option', { name: /Tech Lead/ })).toBeInTheDocument()
  })

  test('clicking an agent inserts its id, which is what a mention is', async () => {
    const user = userEvent.setup()
    render(<Host />)
    const input = screen.getByRole('combobox', { name: 'Add a comment' })
    await user.type(input, 'ask @te')

    await user.click(screen.getByRole('option', { name: /Tech Lead/ }))

    expect(input).toHaveValue('ask @tech-lead ')
  })

  test('Enter picks the highlighted agent rather than posting', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<Host onSubmit={onSubmit} />)
    const input = screen.getByRole('combobox', { name: 'Add a comment' })
    await user.type(input, '@te')

    await user.keyboard('{Enter}')

    expect(input).toHaveValue('@tech-lead ')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('the arrows move through the list', async () => {
    const user = userEvent.setup()
    render(<Host />)
    await user.type(screen.getByRole('combobox', { name: 'Add a comment' }), '@')

    await user.keyboard('{ArrowDown}{Enter}')

    expect(screen.getByRole('combobox', { name: 'Add a comment' })).toHaveValue('@debugging ')
  })

  test('Enter posts the comment when no list is open', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<Host onSubmit={onSubmit} />)

    await user.type(screen.getByRole('combobox', { name: 'Add a comment' }), 'just a note{Enter}')

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  test('Escape dismisses the list without posting', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<Host onSubmit={onSubmit} />)
    await user.type(screen.getByRole('combobox', { name: 'Add a comment' }), '@te')

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('does not offer the roster inside an email address', async () => {
    const user = userEvent.setup()
    render(<Host />)

    await user.type(screen.getByRole('combobox', { name: 'Add a comment' }), 'noel@te')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
