import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { ModelPicker, visibleModels } from '@/components/AgentFields'
import type { ModelInfo } from '@shared/types'
import { installRosterApi } from './rosterApi'

const MODELS: ModelInfo[] = [
  { id: 'anthropic/claude-sonnet-5', price: '$2 / $10', provider: 'Anthropic' },
  { id: 'openai-codex/gpt-6-sol', price: '', signedIn: false, provider: 'OpenAI Codex' },
  { id: 'openai/gpt-5.5', price: '$1 / $8', signedIn: false, provider: 'OpenAI' },
  { id: 'mistral/devstral', price: '', signedIn: false, provider: 'Mistral' },
]

describe('visibleModels', () => {
  test('lists signed-in models and featured providers, not every provider', () => {
    expect(visibleModels(MODELS, '', '').map((m) => m.id)).toEqual([
      'anthropic/claude-sonnet-5',
      'openai-codex/gpt-6-sol',
      'openai/gpt-5.5',
    ])
  })

  test('always keeps the selected model', () => {
    expect(visibleModels(MODELS, 'mistral/devstral', '').map((m) => m.id)).toContain('mistral/devstral')
  })

  test('searches every model by id or provider name', () => {
    expect(visibleModels(MODELS, '', 'mistral').map((m) => m.id)).toEqual(['mistral/devstral'])
    expect(visibleModels(MODELS, '', 'OPENAI').map((m) => m.id)).toEqual([
      'openai-codex/gpt-6-sol',
      'openai/gpt-5.5',
    ])
  })
})

describe('ModelPicker', () => {
  test('marks models that still need a sign-in, and lets them be chosen', () => {
    const onChange = vi.fn()
    render(<ModelPicker models={MODELS} value="" onChange={onChange} />)

    expect(screen.getAllByText('sign in')).toHaveLength(2)
    fireEvent.click(screen.getByText('openai/gpt-5.5'))
    expect(onChange).toHaveBeenCalledWith('openai/gpt-5.5')
  })

  test('finds a model by searching', () => {
    render(<ModelPicker models={MODELS} value="" onChange={() => {}} />)
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'devstral' } })
    expect(screen.getByText('mistral/devstral')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'zzz' } })
    expect(screen.getByText(/No model matches/)).toBeTruthy()
  })
})

describe('ModelPicker — what the account can use', () => {
  const CODEX: ModelInfo[] = [
    { id: 'openai-codex/gpt-6-luna', price: '', provider: 'OpenAI Codex' },
    { id: 'openai-codex/gpt-6-sol', price: '', provider: 'OpenAI Codex', unavailable: 'not supported with a ChatGPT account' },
  ]

  test('greys out a model the account is refused, and will not pick it', () => {
    const onChange = vi.fn()
    render(<ModelPicker models={CODEX} value="openai-codex/gpt-6-luna" onChange={onChange} />)

    expect(screen.getByText('not on your plan')).toBeTruthy()
    const refused = screen.getByText('openai-codex/gpt-6-sol').closest('button')!
    expect(refused.getAttribute('aria-disabled')).toBe('true')
    expect(refused.getAttribute('title')).toMatch(/not supported with a ChatGPT account/)
    fireEvent.click(refused)
    expect(onChange).not.toHaveBeenCalled()
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
