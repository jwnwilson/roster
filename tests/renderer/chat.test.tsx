import { act, render, screen, waitFor } from '@testing-library/react'
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
const voice = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), transcribe: vi.fn(), cancelWorker: vi.fn(), dispose: vi.fn() }))
vi.mock('@/chat/voice/audio', () => ({
  MAX_VOICE_SECONDS: 60,
  BrowserVoiceCapture: class { start = voice.start; stop = voice.stop; cancel = voice.cancel },
}))
vi.mock('@/chat/voice/workerClient', () => ({
  VoiceWorkerClient: class { transcribe = voice.transcribe; cancel = voice.cancelWorker; dispose = voice.dispose },
}))

beforeEach(() => {
  useRoster.setState(INITIAL, true)
  installRosterApi()
  Object.values(voice).forEach((mock) => mock.mockReset())
  voice.start.mockResolvedValue(undefined)
  voice.stop.mockResolvedValue(new Float32Array([0.1]))
  voice.transcribe.mockResolvedValue('find the leak by voice')
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
      queuedCount={0}
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

  test('shows how many submitted messages are waiting', () => {
    render(pane({ isStreaming: true, queuedCount: 2 }))

    expect(screen.getByRole('status')).toHaveTextContent('2 messages are queued.')
  })
})

describe('AssistantChatPane — composer', () => {
  test('shows the skills line and the drop zone', () => {
    render(pane())

    expect(screen.getByText('skills: repro-harness')).toBeInTheDocument()
    expect(screen.getByText('drop files here')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record voice message' })).toBeEnabled()
  })

  test('queues a message while the agent is working', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(pane({ isStreaming: true, onSend }))

    expect(screen.getByLabelText('Message Debugging Agent')).toBeEnabled()
    await user.type(screen.getByLabelText('Message Debugging Agent'), 'queue this')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(onSend).toHaveBeenCalledWith('queue this')
  })

  test('sends what was typed', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(pane({ onSend }))

    await user.type(screen.getByLabelText('Message Debugging Agent'), 'find the leak')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(onSend).toHaveBeenCalledWith('find the leak')
  })

  test('puts a stopped recording in the draft for review before it can send', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(pane({ onSend }))

    await user.click(screen.getByRole('button', { name: 'Record voice message' }))
    await waitFor(() => expect(voice.start).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Stop recording voice message' }))

    await waitFor(() =>
      expect(voice.transcribe).toHaveBeenCalled(),
    )
    expect(screen.getByLabelText('Message Debugging Agent')).toHaveValue('find the leak by voice')
    expect(onSend).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledWith('find the leak by voice')
  })

  test('keeps the typed draft and reports a denied microphone', async () => {
    const user = userEvent.setup()
    voice.start.mockRejectedValue(new Error('Microphone permission denied'))
    render(pane())
    await user.type(screen.getByLabelText('Message Debugging Agent'), 'keep this')

    await user.click(screen.getByRole('button', { name: 'Record voice message' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Microphone permission denied')
    expect(screen.getByLabelText('Message Debugging Agent')).toHaveValue('keep this')
  })

  test('keeps the typed draft when transcription fails', async () => {
    const user = userEvent.setup()
    voice.transcribe.mockRejectedValue(new Error('Local transcription failed.'))
    render(pane())
    await user.type(screen.getByLabelText('Message Debugging Agent'), 'keep this')

    await user.click(screen.getByRole('button', { name: 'Record voice message' }))
    await user.click(screen.getByRole('button', { name: 'Stop recording voice message' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Local transcription failed.')
    expect(screen.getByLabelText('Message Debugging Agent')).toHaveValue('keep this')
  })

  test('asks before downloading the local model and never requests the microphone first', async () => {
    const user = userEvent.setup()
    installRosterApi({
      voice: {
        status: vi.fn().mockResolvedValue({
          engine: 'transformers',
          available: true,
          model: {
            state: 'missing',
            modelId: 'onnx-community/whisper-tiny.en',
            revision: 'fixed',
            bytesDownloaded: 0,
            bytesTotal: 45_081_321,
          },
        }),
      },
    })
    render(pane())

    await user.click(screen.getByRole('button', { name: 'Record voice message' }))

    expect(await screen.findByRole('button', { name: /Download local model/ })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('Voice runs locally and audio is not uploaded')
    expect(voice.start).not.toHaveBeenCalled()
  })

  test('downloads the approved model without sending or recording', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    const api = installRosterApi({
      voice: {
        status: vi.fn().mockResolvedValue({
          engine: 'transformers',
          available: true,
          model: {
            state: 'missing',
            modelId: 'onnx-community/whisper-tiny.en',
            revision: 'fixed',
            bytesDownloaded: 0,
            bytesTotal: 45_081_321,
          },
        }),
        downloadModel: vi.fn().mockResolvedValue({
          state: 'ready',
          modelId: 'onnx-community/whisper-tiny.en',
          revision: 'fixed',
          bytesDownloaded: 45_081_321,
          bytesTotal: 45_081_321,
        }),
      },
    })
    render(pane({ onSend }))

    await user.click(screen.getByRole('button', { name: 'Record voice message' }))
    await user.click(await screen.findByRole('button', { name: /Download local model/ }))

    await waitFor(() => expect(api.voice.downloadModel).toHaveBeenCalled())
    expect(screen.getByRole('status')).toHaveTextContent('model is ready')
    expect(voice.start).not.toHaveBeenCalled()
    expect(onSend).not.toHaveBeenCalled()
  })

  test('Stop cancels the running turn', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(pane({ isStreaming: true, onCancel }))

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onCancel).toHaveBeenCalled()
  })

  test('reports unavailable voice without opening the microphone', async () => {
    vi.mocked(window.roster.voice.status).mockResolvedValue({ engine: 'off', available: false, reason: 'Voice is disabled.' })
    render(pane())
    await userEvent.click(screen.getByRole('button', { name: 'Record voice message' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Voice is disabled.')
    expect(voice.start).not.toHaveBeenCalled()
  })

  test('appends transcription to the latest editable draft without sending', async () => {
    let finish!: (text: string) => void
    voice.transcribe.mockReturnValue(new Promise<string>((resolve) => { finish = resolve }))
    const onSend = vi.fn()
    render(pane({ onSend }))
    await userEvent.click(screen.getByRole('button', { name: 'Record voice message' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Stop recording voice message' }))
    await userEvent.type(screen.getByLabelText('Message Debugging Agent'), 'new draft')
    await act(async () => finish('dictation'))
    expect(screen.getByLabelText('Message Debugging Agent')).toHaveValue('new draft\ndictation')
    expect(onSend).not.toHaveBeenCalled()
  })

  test('cancels pending microphone permission and ignores its late completion', async () => {
    let finish!: () => void
    voice.start.mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    render(pane())
    await userEvent.click(screen.getByRole('button', { name: 'Record voice message' }))
    await userEvent.keyboard('{Escape}')
    await act(async () => finish())
    expect(screen.queryByRole('button', { name: 'Stop recording voice message' })).not.toBeInTheDocument()
    expect(voice.cancel).toHaveBeenCalled()
    expect(voice.transcribe).not.toHaveBeenCalled()
  })

  test.each(['cancel', 'unmount'])('does not start inference after %s during audio decoding', async (action) => {
    let finish!: (audio: Float32Array) => void
    voice.stop.mockReturnValue(new Promise<Float32Array>((resolve) => { finish = resolve }))
    const view = render(pane())
    await userEvent.click(screen.getByRole('button', { name: 'Record voice message' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Stop recording voice message' }))
    if (action === 'unmount') view.unmount()
    else await userEvent.click(screen.getByRole('button', { name: 'Cancel voice transcription' }))
    await act(async () => finish(new Float32Array([0.1])))
    expect(voice.transcribe).not.toHaveBeenCalled()
  })

  test('ignores an old transcription after cancellation and a new recording', async () => {
    let finish!: (text: string) => void
    voice.transcribe.mockReturnValueOnce(new Promise<string>((resolve) => { finish = resolve }))
    render(pane())
    await userEvent.click(screen.getByRole('button', { name: 'Record voice message' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Stop recording voice message' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel voice transcription' }))
    await userEvent.click(screen.getByRole('button', { name: 'Record voice message' }))
    await act(async () => finish('discard this'))
    expect(screen.getByLabelText('Message Debugging Agent')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Stop recording voice message' })).toBeInTheDocument()
  })

  test('switching sessions cancels voice and rejects the previous session transcript', async () => {
    let finish!: (text: string) => void
    voice.transcribe.mockReturnValue(new Promise<string>((resolve) => { finish = resolve }))
    const onSend = vi.fn()
    const view = render(pane({ sessionId: 's1', onSend }))
    await userEvent.click(screen.getByRole('button', { name: 'Record voice message' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Stop recording voice message' }))
    await waitFor(() => expect(voice.transcribe).toHaveBeenCalledOnce())
    view.rerender(pane({ sessionId: 's2', onSend }))
    await userEvent.type(screen.getByLabelText('Message Debugging Agent'), 'new session draft')
    await act(async () => finish('old session dictation'))
    expect(screen.getByLabelText('Message Debugging Agent')).toHaveValue('new session draft')
    expect(voice.cancelWorker).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Record voice message' })).toBeEnabled()
    expect(onSend).not.toHaveBeenCalled()
  })

  test('does not open the microphone when unmounted during the capability check', async () => {
    let finish!: (status: Awaited<ReturnType<typeof window.roster.voice.status>>) => void
    vi.mocked(window.roster.voice.status).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const view = render(pane())
    await userEvent.click(screen.getByRole('button', { name: 'Record voice message' }))
    view.unmount()
    await act(async () => finish({ engine: 'transformers', available: true }))
    expect(voice.start).not.toHaveBeenCalled()
  })

  test('reports model download failures and permits retry', async () => {
    vi.mocked(window.roster.voice.status).mockResolvedValue({ engine: 'transformers', available: true })
    vi.mocked(window.roster.voice.downloadModel).mockRejectedValue(new Error('Download interrupted'))
    render(pane())
    await userEvent.click(screen.getByRole('button', { name: 'Record voice message' }))
    await userEvent.click(await screen.findByRole('button', { name: /Download local model/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Download interrupted')
    expect(screen.getByRole('button', { name: /Download local model/ })).toBeEnabled()
    expect(voice.start).not.toHaveBeenCalled()
  })

  test('unmount cancels pending inference and handles its rejection', async () => {
    let reject!: (error: Error) => void
    voice.transcribe.mockReturnValue(new Promise<string>((_resolve, fail) => { reject = fail }))
    voice.cancelWorker.mockImplementation(() => reject(new Error('Voice transcription was cancelled.')))
    const view = render(pane())
    await userEvent.click(screen.getByRole('button', { name: 'Record voice message' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Stop recording voice message' }))
    await waitFor(() => expect(voice.transcribe).toHaveBeenCalledOnce())
    await act(async () => view.unmount())
    expect(voice.cancelWorker).toHaveBeenCalledOnce()
  })

  test('unmount aborts an active download and handles its rejection', async () => {
    let reject!: (error: Error) => void
    vi.mocked(window.roster.voice.status).mockResolvedValue({ engine: 'transformers', available: true })
    vi.mocked(window.roster.voice.downloadModel).mockReturnValue(new Promise((_resolve, fail) => { reject = fail }))
    vi.mocked(window.roster.voice.cancelModelDownload).mockImplementation(async () => { reject(new Error('Download cancelled')) })
    const view = render(pane())
    await userEvent.click(screen.getByRole('button', { name: 'Record voice message' }))
    await userEvent.click(await screen.findByRole('button', { name: /Download local model/ }))
    await act(async () => view.unmount())
    expect(window.roster.voice.cancelModelDownload).toHaveBeenCalledOnce()
  })

  test('cancelled downloads cannot update the next interaction', async () => {
    let finish!: (result: Awaited<ReturnType<typeof window.roster.voice.downloadModel>>) => void
    vi.mocked(window.roster.voice.status).mockResolvedValue({ engine: 'transformers', available: true })
    vi.mocked(window.roster.voice.downloadModel).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    render(pane())
    await userEvent.click(screen.getByRole('button', { name: 'Record voice message' }))
    await userEvent.click(await screen.findByRole('button', { name: /Download local model/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel download' }))
    await act(async () => finish({ state: 'ready', modelId: 'local', revision: 'fixed', bytesDownloaded: 1, bytesTotal: 1 }))
    expect(window.roster.voice.cancelModelDownload).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('download cancelled')
    expect(screen.getByRole('button', { name: /Download local model/ })).toBeEnabled()
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
