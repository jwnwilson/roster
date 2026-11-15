import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { AutoApproveField } from '@/components/AgentFields'

describe('AutoApproveField', () => {
  test('shows the switch as off when the agent has not opted in', () => {
    render(<AutoApproveField on={false} onToggle={() => {}} supported />)

    expect(screen.getByRole('button', { name: 'Run tools without asking' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  test('says what it skips and what still asks', () => {
    render(<AutoApproveField on={false} onToggle={() => {}} supported />)

    expect(screen.getByText(/questions to you and plan review still ask/i)).toBeInTheDocument()
  })

  test('reports a click so the form can flip the flag', async () => {
    const onToggle = vi.fn()
    render(<AutoApproveField on={false} onToggle={onToggle} supported />)

    await userEvent.click(screen.getByRole('button', { name: 'Run tools without asking' }))

    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  test('is not offered for a harness that has no approval banner yet', () => {
    render(<AutoApproveField on={false} onToggle={() => {}} supported={false} />)

    expect(screen.queryByRole('button', { name: 'Run tools without asking' })).toBeNull()
    expect(screen.getByText(/only claude code agents/i)).toBeInTheDocument()
  })
})
