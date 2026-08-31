import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { HandoffMessage, Message, SpawnMessage } from '@shared/types'
import { AssistantChatPane } from '@/chat/AssistantChatPane'
import {
  HandoffBody,
  SpawnBody,
  TextBody,
  ToolBody,
  formatDuration,
  formatTime,
  prettyArgs,
} from '@/chat/messages'
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
      planMode={false}
      onTogglePlanMode={vi.fn()}
      onAnswer={vi.fn()}
      onSkipQuestions={vi.fn()}
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

  test('expanding shows the whole call, indented', async () => {
    const user = userEvent.setup()
    const input = JSON.stringify({
      questions: [{ question: 'Which cache backend?', options: [{ label: 'Redis' }] }],
    })
    render(
      <ToolBody
        id="t1"
        tool="AskUserQuestion"
        args="Which cache backend?"
        input={input}
        output="no answer"
        isError={false}
      />,
    )

    await user.click(screen.getByRole('button'))

    // The collapsed row is one truncated line, so this is the only place a
    // question's options can be read at all.
    expect(screen.getByText('Arguments')).toBeInTheDocument()
    expect(screen.getByText(/"label": "Redis"/)).toBeInTheDocument()
  })

  test('a row whose summary is the whole call shows only the output', async () => {
    const user = userEvent.setup()
    // Bash: the command is already on the row, so there is no `input` and no
    // Arguments heading repeating it.
    render(<ToolBody id="t1" tool="Bash" args="git push" output="done" isError={false} />)

    await user.click(screen.getByRole('button'))

    expect(screen.queryByText('Arguments')).not.toBeInTheDocument()
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(screen.getAllByText('git push')).toHaveLength(1)
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


describe('TextBody — Markdown in chat', () => {
  test('renders a fenced code block rather than printing its backticks', () => {
    // What an agent actually replies with. The prototype's demo prose had
    // no fences; a real one does on almost every turn.
    const { container } = render(
      <TextBody text={'The command printed:\n\n```\nhello from roster\n```'} />,
    )

    expect(container.querySelector('pre')?.textContent).toContain('hello from roster')
    expect(container.textContent).not.toContain('```')
  })

  test('renders inline code, bold and lists', () => {
    const { container } = render(
      <TextBody text={'Run `pytest` **now**\n\n- first\n- second'} />,
    )

    expect(container.querySelector('code')?.textContent).toBe('pytest')
    expect(container.querySelector('strong')?.textContent).toBe('now')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  test('renders headings an agent uses to structure a long answer', () => {
    render(<TextBody text={'## Findings\n\nThe pool leaks.'} />)

    expect(screen.getByRole('heading', { level: 2, name: 'Findings' })).toBeInTheDocument()
  })

  test('still shows plain prose as plain prose', () => {
    const { container } = render(<TextBody text="Reproduced it on the second run." />)

    expect(container.textContent).toBe('Reproduced it on the second run.')
  })

  test('keeps paragraphs apart, which is what preserving newlines was for', () => {
    const { container } = render(<TextBody text={'First para.\n\nSecond para.'} />)

    expect(container.querySelectorAll('p')).toHaveLength(2)
  })

  test('does not execute HTML an agent emits', () => {
    const { container } = render(
      <TextBody text={'<img src=x onerror="window.pwned=1">done'} />,
    )

    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('done')
  })

  test('renders a partial fence mid-stream without throwing', () => {
    // Prose arrives token by token, so an unclosed fence is a normal
    // intermediate state rather than an error.
    expect(() => render(<TextBody text={'Here you go:\n\n```\nhalf a fen'} />)).not.toThrow()
  })
})

describe('SpawnBody — Markdown in the brief', () => {
  test('renders the handing-off agent\'s Markdown, not its source', () => {
    const brief = { ...SPAWN, text: 'Focus on `api/routes` first.' }
    const { container } = render(<SpawnBody message={brief as SpawnMessage} />)

    expect(container.querySelector('code')?.textContent).toBe('api/routes')
  })
})

describe('the Plan toggle', () => {
  test('is off by default and says so to assistive tech', () => {
    render(pane())

    expect(screen.getByRole('button', { name: 'Plan' })).toHaveAttribute('aria-pressed', 'false')
  })

  test('reports the press rather than deciding for itself', async () => {
    const user = userEvent.setup()
    const onTogglePlanMode = vi.fn()
    render(pane({ onTogglePlanMode }))

    await user.click(screen.getByRole('button', { name: 'Plan' }))

    expect(onTogglePlanMode).toHaveBeenCalledTimes(1)
  })

  test('shows as pressed when the session is planning', () => {
    render(pane({ planMode: true }))

    expect(screen.getByRole('button', { name: 'Plan' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('prettyArgs', () => {
  test('indents a JSON object so its fields can be read', () => {
    expect(prettyArgs('{"a":1}')).toBe('{\n  "a": 1\n}')
  })

  test('passes a plain command through untouched', () => {
    expect(prettyArgs('pytest -k leak')).toBe('pytest -k leak')
  })

  test('leaves a bare JSON scalar alone rather than requoting it', () => {
    // "42" parses, but reformatting it gains nothing and loses the original.
    expect(prettyArgs('42')).toBe('42')
    expect(prettyArgs('null')).toBe('null')
  })

  test('passes malformed JSON through rather than losing it', () => {
    expect(prettyArgs('{"a":')).toBe('{"a":')
  })

  test('shows a lone text field as itself, not as an escaped JSON string', () => {
    // A plan's newlines would otherwise come back as literal \n.
    expect(prettyArgs('{"plan":"## Fix it\\n\\n1. step"}')).toBe('## Fix it\n\n1. step')
  })
})

describe('ToolBody — a plan an agent proposed', () => {
  test('offers to open it, so the plan outlives the approval banner', async () => {
    render(
      <ToolBody
        id="t1"
        tool="ExitPlanMode"
        args="# Archive projects"
        output="ok"
        isError={false}
        planId="plan-1"
      />,
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Review plan' }))

    expect(useRoster.getState().openPlanId).toBe('plan-1')
  })

  test('an ordinary tool row offers nothing of the kind', () => {
    render(<ToolBody id="t1" tool="Bash" args="git push" output="done" isError={false} />)

    expect(screen.queryByRole('button', { name: 'Review plan' })).not.toBeInTheDocument()
  })
})
