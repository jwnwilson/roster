import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { HandoffMessage, Message, SpawnMessage } from '@shared/types'
import { AssistantChatPane } from '@/chat/AssistantChatPane'
import { HandoffBody, SpawnBody, ToolBody, formatDuration, formatTime } from '@/chat/messages'
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

const TOOL: Message = {
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

const SPAWN: SpawnMessage = {
  id: 'sp1',
  sessionId: 's1',
  kind: 'spawn',
  createdAt: AT,
  from: 'Architect Agent',
  text: 'Reproduce and patch the connection leak.',
  to: { agentId: 'architect', sessionId: 'arch-1', label: 'Architect Agent · ADR-014' },
}

const HANDOFF: HandoffMessage = {
  id: 'h1',
  sessionId: 's1',
  kind: 'handoff',
  createdAt: AT,
  links: [
    { agentId: 'debug', sessionId: 'd1', label: 'Debugging Agent · leak', status: 'approval' },
    { agentId: 'debug', sessionId: 'd3', label: 'Debugging Agent · migration', status: 'running' },
  ],
}

function pane(overrides: Partial<Parameters<typeof AssistantChatPane>[0]> = {}) {
  return (
    <AssistantChatPane
      sessionId="s1"
      agentName="Debugging Agent"
      messages={[]}
      isStreaming={false}
      streamingText="Debugging Agent is working…"
      skillsLine="skills: repro-harness"
      onSend={vi.fn()}
      onCancel={vi.fn()}
      {...overrides}
    />
  )
}

/* ---- bodies, rendered directly ---------------------------------------- */

describe('ToolBody', () => {
  test('is collapsed by default, showing the tool and its arguments', () => {
    render(<ToolBody id="t1" tool="run_command" args="pytest -k leak" output="1 passed" isError={false} />)

    expect(screen.getByText('run_command')).toBeInTheDocument()
    expect(screen.getByText('pytest -k leak')).toBeInTheDocument()
    expect(screen.queryByText('1 passed')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  })

  test('expands on click to reveal the output', async () => {
    const user = userEvent.setup()
    render(<ToolBody id="t1" tool="run_command" args="x" output="1 passed" isError={false} />)

    await user.click(screen.getByRole('button'))
    expect(screen.getByText('1 passed')).toBeInTheDocument()
  })

  test('each tool call expands independently', async () => {
    const user = userEvent.setup()
    render(
      <>
        <ToolBody id="t1" tool="a" args="" output="first output" isError={false} />
        <ToolBody id="t2" tool="b" args="" output="second output" isError={false} />
      </>,
    )

    await user.click(screen.getAllByRole('button')[0]!)

    expect(screen.getByText('first output')).toBeInTheDocument()
    expect(screen.queryByText('second output')).not.toBeInTheDocument()
  })

  test('shows a placeholder while the tool is still running', () => {
    render(<ToolBody id="t1" tool="a" args="" output="" isError={false} />)
    expect(screen.getByText('…')).toBeInTheDocument()
  })

  test('says so when a finished tool produced nothing', async () => {
    const user = userEvent.setup()
    render(<ToolBody id="t1" tool="a" args="" output="" isError />)

    await user.click(screen.getByRole('button'))
    expect(screen.getByText('no output')).toBeInTheDocument()
  })
})

describe('SpawnBody', () => {
  test('shows why the session was opened', () => {
    render(<SpawnBody message={SPAWN} />)
    expect(screen.getByText('Reproduce and patch the connection leak.')).toBeInTheDocument()
  })

  test('the back pill navigates to the originating session', async () => {
    const user = userEvent.setup()
    render(<SpawnBody message={SPAWN} />)

    await user.click(screen.getByRole('button', { name: /Architect Agent · ADR-014/ }))

    expect(useRoster.getState().agentId).toBe('architect')
    expect(useRoster.getState().sess['architect']).toBe('arch-1')
  })

  test('renders without a back pill when there is nowhere to go', () => {
    const { to, ...withoutTarget } = SPAWN
    render(<SpawnBody message={withoutTarget as SpawnMessage} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('HandoffBody', () => {
  test('renders one pill per opened session', () => {
    render(<HandoffBody message={HANDOFF} />)

    expect(screen.getByText(/Debugging Agent · leak/)).toBeInTheDocument()
    expect(screen.getByText(/Debugging Agent · migration/)).toBeInTheDocument()
  })

  test('each pill jumps to its target agent and session', async () => {
    const user = userEvent.setup()
    render(<HandoffBody message={HANDOFF} />)

    await user.click(screen.getByRole('button', { name: /migration/ }))

    expect(useRoster.getState().agentId).toBe('debug')
    expect(useRoster.getState().sess['debug']).toBe('d3')
  })
})

/* ---- the pane, through the assistant-ui runtime ------------------------ */

describe('AssistantChatPane — transcript', () => {
  test('invites the first message when the session is empty', () => {
    render(pane())
    expect(screen.getByText(/send Debugging Agent a message/)).toBeInTheDocument()
  })

  test('renders text messages with their header', () => {
    render(pane({ messages: [textMessage()] }))

    expect(screen.getByText('Debugging Agent')).toBeInTheDocument()
    expect(screen.getByText('Reproduced the leak.')).toBeInTheDocument()
  })

  test('renders a tool call through the tool-call part', () => {
    render(pane({ messages: [TOOL] }))

    expect(screen.getByText('run_command')).toBeInTheDocument()
    expect(screen.getByText('tool call')).toBeInTheDocument()
  })

  test('renders a spawn through its data part, header and all', () => {
    render(pane({ messages: [SPAWN] }))

    expect(screen.getByText('session opened by Architect Agent')).toBeInTheDocument()
    expect(screen.getByText('Reproduce and patch the connection leak.')).toBeInTheDocument()
  })

  test('renders a handoff through its data part', () => {
    render(pane({ messages: [HANDOFF] }))

    expect(screen.getByText('opened sessions')).toBeInTheDocument()
    expect(screen.getByText(/Debugging Agent · leak/)).toBeInTheDocument()
  })

  test('renders a whole mixed transcript', () => {
    render(pane({ messages: [textMessage({ id: 'm1', role: 'user', who: 'you' }), TOOL, HANDOFF] }))

    expect(screen.getByText('you')).toBeInTheDocument()
    expect(screen.getByText('tool call')).toBeInTheDocument()
    expect(screen.getByText('opened sessions')).toBeInTheDocument()
  })
})

describe('AssistantChatPane — composer', () => {
  test('shows the skills line and the drop zone', () => {
    render(pane())

    expect(screen.getByText('skills: repro-harness')).toBeInTheDocument()
    expect(screen.getByText('drop files here')).toBeInTheDocument()
  })

  test('sends what was typed', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(pane({ onSend }))

    await user.type(screen.getByLabelText('Message Debugging Agent'), 'find the leak')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(onSend).toHaveBeenCalledWith('find the leak')
  })

  test('locks the composer while a turn is in flight', () => {
    render(pane({ isStreaming: true }))

    expect(screen.getByLabelText('Message Debugging Agent')).toBeDisabled()
    expect(screen.getByText('Debugging Agent is working…')).toBeInTheDocument()
  })

  test('Stop cancels the running turn', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(pane({ isStreaming: true, onCancel }))

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onCancel).toHaveBeenCalled()
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
