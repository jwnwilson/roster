import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { ModelPicker, modelsFor, providerOptions } from '@/components/AgentFields'
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

    expect((screen.getByLabelText('Provider') as HTMLSelectElement).value).toBe('xai')
    const model = screen.getByLabelText('Model') as HTMLSelectElement
    expect(model.value).toBe('xai/grok-5')
    expect([...model.options].map((o) => o.value)).toEqual(['xai/grok-5'])
  })

  test("switching provider picks that provider's first usable model", () => {
    const onChange = vi.fn()
    render(<ModelPicker models={MODELS} value="xai/grok-5" onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'anthropic' } })
    expect(onChange).toHaveBeenCalledWith('anthropic/claude-sonnet-5')
  })

  test('choosing a model reports its full id', () => {
    const onChange = vi.fn()
    render(<ModelPicker models={MODELS} value="anthropic/claude-sonnet-5" onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'anthropic/claude-opus-5' } })
    expect(onChange).toHaveBeenCalledWith('anthropic/claude-opus-5')
  })

  test('says a provider still needs a sign-in, and lets its models be chosen', () => {
    render(<ModelPicker models={MODELS} value="openai-codex/gpt-6-sol" onChange={() => {}} />)

    expect(screen.getByRole('option', { name: /OpenAI Codex — sign in/ })).toBeTruthy()
    expect(screen.getByText(/will ask to sign in/)).toBeTruthy()
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

    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai-codex' } })
    expect(onChange).toHaveBeenCalledWith('openai-codex/gpt-6-luna')
  })

  test('checks the selected provider and hands the updated list back', async () => {
    const updated = [{ ...CODEX[0]! }, { ...CODEX[1]! }]
    installRosterApi({ runners: { checkModels: vi.fn().mockResolvedValue(updated) } })
    const onModelsChanged = vi.fn()
    render(
      <ModelPicker models={CODEX} value="openai-codex/gpt-6-luna" onChange={() => {}} onModelsChanged={onModelsChanged} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Check which OpenAI Codex models your account can use' }))

    await vi.waitFor(() => expect(onModelsChanged).toHaveBeenCalledWith(updated))
    expect(window.roster.runners.checkModels).toHaveBeenCalledWith('pi', 'openai-codex')
  })

  test('offers no check for a provider that is not signed in', () => {
    render(
      <ModelPicker
        models={[{ id: 'openai/gpt-5.5', price: '', signedIn: false }]}
        value="openai/gpt-5.5"
        onChange={() => {}}
        onModelsChanged={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /Check which/ })).toBeNull()
  })
})
