import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ProviderSummary, SignInEvent } from '@shared/types'
import { SignInModal } from '@/components/SignInModal'
import { installRosterApi } from './rosterApi'

const ANTHROPIC: ProviderSummary = {
  id: 'anthropic',
  name: 'Anthropic',
  signedIn: false,
  subscription: false,
  methods: [
    { method: 'oauth', label: 'Sign in with account', description: 'Claude Pro/Max — opens your browser' },
    { method: 'api_key', label: 'Enter an API key', description: 'Anthropic API key' },
  ],
}

const OPENAI: ProviderSummary = {
  id: 'openai',
  name: 'OpenAI',
  signedIn: false,
  subscription: false,
  methods: [{ method: 'api_key', label: 'Enter an API key', description: 'OpenAI API key' }],
}

/** Captures the window's event stream so a test can play Pi's side of it. */
function wire(start: () => Promise<unknown> = async () => ({ ok: true })) {
  let listener: (event: SignInEvent) => void = () => {}
  const api = installRosterApi({
    signIn: {
      providers: vi.fn().mockResolvedValue([ANTHROPIC, OPENAI]),
      start: vi.fn(start),
      onEvent: vi.fn((l: (event: SignInEvent) => void) => {
        listener = l
        return () => {}
      }),
    },
  })
  const emit = (event: SignInEvent) => act(() => listener(event))
  return { api, emit }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('SignInModal', () => {
  test('lists providers, and starts the chosen one with the chosen way in', async () => {
    const { api } = wire()
    render(<SignInModal providers={[ANTHROPIC, OPENAI]} onClose={() => {}} onSignedIn={() => {}} />)

    await userEvent.click(screen.getByRole('radio', { name: /OpenAI/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(api.signIn.start).toHaveBeenCalledWith('openai', 'api_key'))
  })

  test('asks for a way in when a provider has more than one, account first', async () => {
    const { api } = wire()
    render(<SignInModal providers={[ANTHROPIC]} onClose={() => {}} onSignedIn={() => {}} />)

    await userEvent.click(screen.getByRole('radio', { name: 'Enter an API key' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(api.signIn.start).toHaveBeenCalledWith('anthropic', 'api_key'))
  })

  test('shows a question from Pi and sends the typed answer back, then reports success', async () => {
    let finish: (value: unknown) => void = () => {}
    const { api, emit } = wire(() => new Promise((resolve) => (finish = resolve)))
    const onSignedIn = vi.fn()
    render(
      <SignInModal
        providers={[ANTHROPIC]}
        initial={{ providerId: 'anthropic', method: 'oauth' }}
        onClose={() => {}}
        onSignedIn={onSignedIn}
      />,
    )

    emit({
      type: 'prompt',
      prompt: {
        id: 'p1',
        question: { question: 'Paste the code', header: 'Sign in', multiSelect: false, options: [{ label: 'Cancel', description: '' }] },
        secret: false,
      },
    })
    await userEvent.type(await screen.findByRole('textbox', { name: 'Paste the code' }), 'abc123')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(api.signIn.answer).toHaveBeenCalledWith('p1', { approved: true, answers: { 'Paste the code': 'abc123' } })
    await act(async () => finish({ ok: true }))
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith('Anthropic'))
  })

  test('masks an API key as it is typed', async () => {
    const { emit } = wire(() => new Promise(() => {}))
    render(
      <SignInModal providers={[OPENAI]} initial={{ providerId: 'openai', method: 'api_key' }} onClose={() => {}} onSignedIn={() => {}} />,
    )
    emit({
      type: 'prompt',
      prompt: {
        id: 'k',
        question: { question: 'OpenAI API key', header: 'Sign in', multiSelect: false, options: [{ label: 'Cancel', description: '' }] },
        secret: true,
      },
    })
    expect(await screen.findByLabelText('OpenAI API key')).toHaveAttribute('type', 'password')
  })

  test('cancelling while Pi is asking stops the whole sign-in', async () => {
    const { api, emit } = wire(() => new Promise(() => {}))
    const onClose = vi.fn()
    render(<SignInModal providers={[ANTHROPIC]} initial={{ providerId: 'anthropic', method: 'oauth' }} onClose={onClose} onSignedIn={() => {}} />)
    emit({
      type: 'prompt',
      prompt: {
        id: 'p2',
        question: { question: 'Paste the code', header: 'Sign in', multiSelect: false, options: [{ label: 'Cancel', description: '' }] },
        secret: false,
      },
    })
    await screen.findByRole('textbox', { name: 'Paste the code' })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.signIn.cancel).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  test('shows device codes Pi asks the user to enter', async () => {
    const { emit } = wire(() => new Promise(() => {}))
    render(<SignInModal providers={[ANTHROPIC]} initial={{ providerId: 'anthropic', method: 'oauth' }} onClose={() => {}} onSignedIn={() => {}} />)
    emit({ type: 'notice', text: 'Enter code WDJB-MJHT at https://github.com/login/device' })
    expect(await screen.findByText('Enter code WDJB-MJHT at https://github.com/login/device')).toBeInTheDocument()
  })

  test('a failed sign-in says why, and can be tried again', async () => {
    wire(async () => ({ ok: false, message: 'Could not sign in to Anthropic: try again.' }))
    render(<SignInModal providers={[ANTHROPIC]} initial={{ providerId: 'anthropic', method: 'oauth' }} onClose={() => {}} onSignedIn={() => {}} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not sign in to Anthropic: try again.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByRole('radio', { name: /Anthropic/ })).toBeInTheDocument()
  })

  test('cancelling stops the sign-in that is running', async () => {
    const { api } = wire(() => new Promise(() => {}))
    const onClose = vi.fn()
    render(<SignInModal providers={[ANTHROPIC]} initial={{ providerId: 'anthropic', method: 'oauth' }} onClose={onClose} onSignedIn={() => {}} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(api.signIn.cancel).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
