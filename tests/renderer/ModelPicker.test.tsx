import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { ModelPicker, visibleModels } from '@/components/AgentFields'
import type { ModelInfo } from '@shared/types'

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
