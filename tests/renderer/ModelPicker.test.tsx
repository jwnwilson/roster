import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { HarnessModelPicker, ModelPicker, ProviderPicker, modelsFor, providerOptions } from '@/components/AgentFields'
import type { RunnerStatus } from '@shared/types'
import type { ModelInfo } from '@shared/types'
import { installRosterApi } from './rosterApi'

const MODELS: ModelInfo[] = [
  { id: 'mistral/devstral', price: '', signedIn: false, provider: 'Mistral' },
  { id: 'anthropic/claude-sonnet-5', price: '$2 / $10', provider: 'Anthropic' },
  { id: 'anthropic/claude-opus-5', price: '$5 / $25', provider: 'Anthropic' },
  { id: 'openai-codex/gpt-6-sol', price: '', signedIn: false, provider: 'OpenAI Codex' },
  { id: 'xai/grok-5', price: '$3 / $15', provider: 'xAI' },
  { id: 'aaa/zeta', price: '', signedIn: false },
]

describe('providerOptions', () => {
  test('one entry per provider: featured first, then signed in, then the rest by name', () => {
    expect(providerOptions(MODELS).map((p) => p.id)).toEqual([
      'anthropic',
      'openai-codex',
      'xai',
      'aaa',
      'mistral',
    ])
  })

  test('names a provider by its display name, falling back to its id, and says when it needs a sign-in', () => {
    const byId = Object.fromEntries(providerOptions(MODELS).map((p) => [p.id, p]))
    expect(byId['anthropic']).toMatchObject({ name: 'Anthropic', signedIn: true })
    expect(byId['openai-codex']).toMatchObject({ name: 'OpenAI Codex', signedIn: false })
    expect(byId['aaa']).toMatchObject({ name: 'aaa', signedIn: false })
  })
})

test('lists a model with no provider prefix under Other', () => {
  expect(providerOptions([{ id: 'claude-opus-5', price: '' }])).toEqual([
    { id: 'other', name: 'Other', signedIn: true },
  ])
})

describe('modelsFor', () => {
  test("keeps only that provider's models", () => {
    expect(modelsFor(MODELS, 'anthropic').map((m) => m.id)).toEqual([
      'anthropic/claude-sonnet-5',
      'anthropic/claude-opus-5',
    ])
  })
})

describe('ModelPicker', () => {
  test("starts on the selected model's provider and lists only its models", () => {
    render(<ModelPicker models={MODELS} value="xai/grok-5" onChange={() => {}} />)

    expect(screen.getByLabelText('Provider')).toHaveValue('xAI')
    const model = screen.getByLabelText('Model') as HTMLSelectElement
    expect(model.value).toBe('xai/grok-5')
    expect([...model.options].map((o) => o.value)).toEqual(['xai/grok-5'])
  })

  test('typing filters the provider options, and the list shows them', () => {
    render(<ModelPicker models={MODELS} value="xai/grok-5" onChange={() => {}} />)

    const input = screen.getByLabelText('Provider')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'open' } })

    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options.map((o) => o.firstChild?.textContent)).toEqual(['OpenAI Codex'])
    expect(options[0]).toHaveTextContent('sign in')
  })

  test('shows every provider when the box is opened empty', () => {
    render(<ModelPicker models={MODELS} value="xai/grok-5" onChange={() => {}} />)
    fireEvent.focus(screen.getByLabelText('Provider'))
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(providerOptions(MODELS).length)
  })

  test('picking a typed provider selects its first usable model', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ModelPicker models={MODELS} value="xai/grok-5" onChange={onChange} />)

    const input = screen.getByLabelText('Provider')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'anth' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: /Anthropic/ }))
    expect(onChange).toHaveBeenCalledWith('anthropic/claude-sonnet-5')

    rerender(<ModelPicker models={MODELS} value="anthropic/claude-sonnet-5" onChange={onChange} />)
    expect(screen.getByLabelText('Provider')).toHaveValue('Anthropic')
  })

  test('Enter picks the highlighted provider', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ModelPicker models={MODELS} value="xai/grok-5" onChange={onChange} />)

    const input = screen.getByLabelText('Provider')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'anth' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('anthropic/claude-sonnet-5')

    rerender(<ModelPicker models={MODELS} value="anthropic/claude-sonnet-5" onChange={onChange} />)
    expect(screen.getByLabelText('Provider')).toHaveValue('Anthropic')
  })

  test('leaving the box without picking restores the current provider', () => {
    render(<ModelPicker models={MODELS} value="xai/grok-5" onChange={() => {}} />)

    const input = screen.getByLabelText('Provider')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'zzz' } })
    expect(screen.getByText('No provider matches “zzz”.')).toBeTruthy()
    fireEvent.blur(input)
    expect(input).toHaveValue('xAI')
  })

  test('choosing a model reports its full id', () => {
    const onChange = vi.fn()
    render(<ModelPicker models={MODELS} value="anthropic/claude-sonnet-5" onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'anthropic/claude-opus-5' } })
    expect(onChange).toHaveBeenCalledWith('anthropic/claude-opus-5')
  })

  test('says a provider still needs a sign-in, and lets its models be chosen', () => {
    render(<ModelPicker models={MODELS} value="openai-codex/gpt-6-sol" onChange={() => {}} />)

    expect(screen.getByText(/Not signed in to OpenAI Codex yet/)).toBeTruthy()
    const option = screen.getByRole('option', { name: /gpt-6-sol/ }) as HTMLOptionElement
    expect(option.disabled).toBe(false)
  })

  test('shows nothing to choose when there are no models', () => {
    render(<ModelPicker models={[]} value="" onChange={() => {}} />)
    expect(screen.getByText(/No models available/)).toBeTruthy()
  })
})

describe('ModelPicker — what the account can use', () => {
  const CODEX: ModelInfo[] = [
    { id: 'openai-codex/gpt-6-luna', price: '', provider: 'OpenAI Codex' },
    { id: 'openai-codex/gpt-6-sol', price: '', provider: 'OpenAI Codex', unavailable: 'not supported with a ChatGPT account' },
  ]

  test('greys out a model the account is refused, so it cannot be picked', () => {
    render(<ModelPicker models={CODEX} value="openai-codex/gpt-6-luna" onChange={() => {}} />)

    const refused = screen.getByRole('option', { name: /gpt-6-sol/ }) as HTMLOptionElement
    expect(refused.disabled).toBe(true)
    expect(refused.textContent).toMatch(/not on your plan/)
  })

  test('switching to a provider skips models the account is refused', () => {
    const onChange = vi.fn()
    const models: ModelInfo[] = [
      { id: 'xai/grok-5', price: '', provider: 'xAI' },
      { ...CODEX[1]! },
      { ...CODEX[0]! },
    ]
    render(<ModelPicker models={models} value="xai/grok-5" onChange={onChange} />)

    const input = screen.getByLabelText('Provider')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'codex' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: /OpenAI Codex/ }))
    expect(onChange).toHaveBeenCalledWith('openai-codex/gpt-6-luna')
  })

  test('selecting Anthropic checks the account automatically and hands the list back', async () => {
    const ANTHROPIC: ModelInfo[] = [
      { id: 'anthropic/claude-opus-5', price: '', provider: 'Anthropic' },
      { id: 'xai/grok-5', price: '', provider: 'xAI' },
    ]
    const updated = [{ ...ANTHROPIC[0]!, unavailable: 'needs a higher plan' }, ANTHROPIC[1]!]
    installRosterApi({ runners: { checkModels: vi.fn().mockResolvedValue(updated) } })
    const onModelsChanged = vi.fn()
    render(<ModelPicker models={ANTHROPIC} value="xai/grok-5" onChange={() => {}} onModelsChanged={onModelsChanged} />)

    const input = screen.getByLabelText('Provider')
    fireEvent.focus(input)
    fireEvent.mouseDown(screen.getByRole('option', { name: /Anthropic/ }))

    await vi.waitFor(() => expect(onModelsChanged).toHaveBeenCalledWith(updated))
    expect(window.roster.runners.checkModels).toHaveBeenCalledWith('pi', 'anthropic')
  })

  test('no check button is offered for any provider', () => {
    render(<ModelPicker models={CODEX} value="openai-codex/gpt-6-luna" onChange={() => {}} onModelsChanged={() => {}} />)
    expect(screen.queryByRole('button', { name: /Check which/ })).toBeNull()
  })

  test('selecting a provider other than Anthropic does not run the check', () => {
    installRosterApi({ runners: { checkModels: vi.fn().mockResolvedValue([]) } })
    const models: ModelInfo[] = [
      { id: 'xai/grok-5', price: '', provider: 'xAI' },
      { id: 'openai-codex/gpt-6-luna', price: '', provider: 'OpenAI Codex' },
    ]
    render(<ModelPicker models={models} value="xai/grok-5" onChange={() => {}} onModelsChanged={() => {}} />)

    const input = screen.getByLabelText('Provider')
    fireEvent.focus(input)
    fireEvent.mouseDown(screen.getByRole('option', { name: /OpenAI Codex/ }))
    expect(window.roster.runners.checkModels).not.toHaveBeenCalled()
  })
})

describe('ProviderPicker — the harness cards', () => {
  const RUNNERS: RunnerStatus[] = [
    { id: 'pi', provider: 'Pi · anthropic', installed: true, ready: true, auth: 'subscription' },
    { id: 'claude', provider: 'Anthropic', installed: true, ready: true, auth: 'subscription' },
    { id: 'codex', provider: 'OpenAI', installed: false, ready: false, auth: 'none' },
  ]

  test('names each harness as itself, not by the provider it reaches', () => {
    render(<ProviderPicker runners={RUNNERS} value="pi" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /Pi/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Claude Code/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Codex/ })).toHaveTextContent('not installed')
  })

  test('picking a harness reports its id', () => {
    const onChange = vi.fn()
    render(<ProviderPicker runners={RUNNERS} value="pi" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Claude Code/ }))
    expect(onChange).toHaveBeenCalledWith('claude')
  })
})

describe('HarnessModelPicker', () => {
  const CLAUDE: ModelInfo[] = [
    { id: 'claude-opus-5', price: '$5 / $25' },
    { id: 'claude-sonnet-5', price: '' },
  ]

  test('lists the harness models flat, with their prices, and no provider grouping', () => {
    render(<HarnessModelPicker models={CLAUDE} value="claude-opus-5" onChange={() => {}} />)
    expect(screen.queryByLabelText('Provider')).toBeNull()
    expect(screen.getByLabelText('Model')).toHaveValue('claude-opus-5')
    expect(screen.getByRole('option', { name: 'claude-opus-5 · $5 / $25' })).toBeTruthy()
  })

  test('choosing a model reports its id', () => {
    const onChange = vi.fn()
    render(<HarnessModelPicker models={CLAUDE} value="claude-opus-5" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'claude-sonnet-5' } })
    expect(onChange).toHaveBeenCalledWith('claude-sonnet-5')
  })

  test('asks for a model when the agent has none that the harness knows', () => {
    render(<HarnessModelPicker models={CLAUDE} value="gpt-5.5" onChange={() => {}} />)
    expect(screen.getByLabelText('Model')).toHaveValue('')
    expect(screen.getByRole('option', { name: 'Choose a model' })).toBeTruthy()
  })
})
