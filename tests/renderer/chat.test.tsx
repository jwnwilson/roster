import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Message } from '@shared/types'
import { ChatPane } from '@/chat/ChatPane'
import { MessageView, formatDuration, formatTime } from '@/chat/messages'
import { useRoster } from '@/state/store'
import { installRosterApi } from './rosterApi'

const INITIAL = useRoster.getState()

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  installRosterApi()
})

const AT = new Date('2026-08-23T14:03:00').getTime()

function textMessage(overrides: Partial<Extract<Message, { kind: 'text' }>> = {}): Message {
  return {
    id: 'm1',
    sessionId: 's1',
    kind: 'text',
    createdAt: AT,
    role: 'assistant',
    who: 'Debugging Agent',
    text: 'Reproduced the leak.',
    ...overrides,
  }
}

describe('MessageView — text', () => {
  test('shows the role label, timestamp, and body', () => {
    render(<MessageView message={textMessage()} agentName="Debugging Agent" />)

    expect(screen.getByText('Debugging Agent')).toBeInTheDocument()
    expect(screen.getByText('Reproduced the leak.')).toBeInTheDocument()
  })

  test('preserves newlines rather than collapsing them', () => {
    render(
      <MessageView
        message={textMessage({ text: 'One.\n\nTwo.' })}
        agentName="Debugging Agent"
      />,
    )

    expect(screen.getByText(/One\./)).toHaveClass('whitespace-pre-wrap')
  })
})

describe('MessageView — tool call', () => {
  const tool: Message = {
    id: 't1',
    sessionId: 's1',
    kind: 'tool',
    createdAt: AT,
    tool: 'run_command',
    args: 'pytest tests/test_pool.py -k leak',
    output: '1 passed in 8.31s',
    isError: false,
    durationMs: 8_400,
  }

  test('is collapsed by default, showing the tool and its arguments', () => {
    render(<MessageView message={tool} agentName="A" />)

    expect(screen.getByText('run_command')).toBeInTheDocument()
    expect(screen.getByText('pytest tests/test_pool.py -k leak')).toBeInTheDocument()
    expect(screen.queryByText('1 passed in 8.31s')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  })

  test('expands on click to reveal the output', async () => {
    const user = userEvent.setup()
    render(<MessageView message={tool} agentName="A" />)

    await user.click(screen.getByRole('button'))

    expect(screen.getByText('1 passed in 8.31s')).toBeInTheDocument()
  })

  test('each tool call expands independently', async () => {
    const user = userEvent.setup()
    render(
      <>
        <MessageView message={tool} agentName="A" />
        <MessageView message={{ ...tool, id: 't2', output: 'second output' }} agentName="A" />
      </>,
    )

    await user.click(screen.getAllByRole('button')[0]!)

    expect(screen.getByText('1 passed in 8.31s')).toBeInTheDocument()
    expect(screen.queryByText('second output')).not.toBeInTheDocument()
  })

  test('shows a placeholder while the tool is still running', () => {
    render(<MessageView message={{ ...tool, output: '' }} agentName="A" />)
    expect(screen.getByText('…')).toBeInTheDocument()
  })

  test('says so when a finished tool produced nothing', async () => {
    const user = userEvent.setup()
    render(<MessageView message={{ ...tool, output: '', isError: true }} agentName="A" />)

    await user.click(screen.getByRole('button'))
    expect(screen.getByText('no output')).toBeInTheDocument()
  })
})

describe('MessageView — spawn', () => {
  const spawn: Message = {
    id: 'sp1',
    sessionId: 's1',
    kind: 'spawn',
    createdAt: AT,
    from: 'Architect Agent',
    text: 'Reproduce and patch the connection leak.',
    to: { agentId: 'architect', sessionId: 'arch-1', label: 'Architect Agent · ADR-014' },
  }

  test('names who opened the session and why', () => {
    render(<MessageView message={spawn} agentName="Debugging Agent" />)

    expect(screen.getByText('session opened by Architect Agent')).toBeInTheDocument()
    expect(screen.getByText('Reproduce and patch the connection leak.')).toBeInTheDocument()
  })

  test('the back pill navigates to the originating session', async () => {
    const user = userEvent.setup()
    render(<MessageView message={spawn} agentName="Debugging Agent" />)

    await user.click(screen.getByRole('button', { name: /Architect Agent · ADR-014/ }))

    expect(useRoster.getState().agentId).toBe('architect')
    expect(useRoster.getState().sess['architect']).toBe('arch-1')
  })

  test('renders without a back pill when there is nowhere to go', () => {
    const { to, ...withoutTarget } = spawn as Extract<Message, { kind: 'spawn' }>
    render(<MessageView message={withoutTarget as Message} agentName="A" />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('MessageView — handoff', () => {
  const handoff: Message = {
    id: 'h1',
    sessionId: 's1',
    kind: 'handoff',
    createdAt: AT,
    links: [
      { agentId: 'debug', sessionId: 'd1', label: 'Debugging Agent · leak', status: 'approval' },
      { agentId: 'debug', sessionId: 'd3', label: 'Debugging Agent · migration', status: 'running' },
    ],
  }

  test('renders one pill per opened session', () => {
    render(<MessageView message={handoff} agentName="Architect Agent" />)

    expect(screen.getByText(/Debugging Agent · leak/)).toBeInTheDocument()
    expect(screen.getByText(/Debugging Agent · migration/)).toBeInTheDocument()
  })

  test('each pill jumps to its target agent and session', async () => {
    const user = userEvent.setup()
    render(<MessageView message={handoff} agentName="Architect Agent" />)

    await user.click(screen.getByRole('button', { name: /migration/ }))

    expect(useRoster.getState().agentId).toBe('debug')
    expect(useRoster.getState().sess['debug']).toBe('d3')
  })
})

describe('ChatPane', () => {
  const defaults = {
    sessionId: 's1',
    agentName: 'Debugging Agent',
    messages: [] as Message[],
    isStreaming: false,
    streamingText: 'Debugging Agent is working…',
    skillsLine: 'skills: repro-harness',
    onSend: vi.fn(),
    onCancel: vi.fn(),
  }

  test('invites the first message when the session is empty', () => {
    render(<ChatPane {...defaults} onSend={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText(/send Debugging Agent a message/)).toBeInTheDocument()
  })

  test('shows the skills line and the drop zone', () => {
    render(<ChatPane {...defaults} onSend={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByText('skills: repro-harness')).toBeInTheDocument()
    expect(screen.getByText('drop files here')).toBeInTheDocument()
  })

  test('Send is disabled until something is typed', async () => {
    const user = userEvent.setup()
    render(<ChatPane {...defaults} onSend={vi.fn()} onCancel={vi.fn()} />)

    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toBeDisabled()

    await user.type(screen.getByLabelText('Message Debugging Agent'), 'find the leak')
    expect(send).toBeEnabled()
  })

  test('sends on click and clears the composer', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<ChatPane {...defaults} onSend={onSend} onCancel={vi.fn()} />)

    const box = screen.getByLabelText('Message Debugging Agent')
    await user.type(box, 'find the leak')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(onSend).toHaveBeenCalledWith('find the leak')
    expect(box).toHaveValue('')
  })

  test('Enter sends, Shift+Enter does not', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<ChatPane {...defaults} onSend={onSend} onCancel={vi.fn()} />)

    const box = screen.getByLabelText('Message Debugging Agent')
    await user.type(box, 'one{Shift>}{Enter}{/Shift}two')
    expect(onSend).not.toHaveBeenCalled()

    await user.type(box, '{Enter}')
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  test('refuses to send whitespace', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<ChatPane {...defaults} onSend={onSend} onCancel={vi.fn()} />)

    await user.type(screen.getByLabelText('Message Debugging Agent'), '   {Enter}')
    expect(onSend).not.toHaveBeenCalled()
  })

  test('locks the composer while a turn is in flight', () => {
    render(<ChatPane {...defaults} isStreaming onSend={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByLabelText('Message Debugging Agent')).toBeDisabled()
    expect(screen.getByText('Debugging Agent is working…')).toBeInTheDocument()
  })

  test('Stop cancels the running turn', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<ChatPane {...defaults} isStreaming onSend={vi.fn()} onCancel={onCancel} />)

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onCancel).toHaveBeenCalled()
  })

  test('renders the transcript in order', () => {
    const messages = [
      textMessage({ id: 'm1', role: 'user', who: 'you', text: 'Find the leak.' }),
      textMessage({ id: 'm2', text: 'Reproduced it.' }),
    ]
    render(<ChatPane {...defaults} messages={messages} onSend={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByText('Find the leak.')).toBeInTheDocument()
    expect(screen.getByText('Reproduced it.')).toBeInTheDocument()
  })
})

describe('formatting', () => {
  test('durations under a second read in milliseconds', () => {
    expect(formatDuration(420)).toBe('420ms')
  })

  test('longer durations read in seconds to one decimal', () => {
    expect(formatDuration(8_400)).toBe('8.4s')
  })

  test('an unknown duration renders as nothing', () => {
    expect(formatDuration(undefined)).toBe('')
  })

  test('timestamps render as a wall clock time', () => {
    expect(formatTime(AT)).toMatch(/\d{1,2}:\d{2}/)
  })
})
