import { describe, expect, test, vi } from 'vitest'
import type { SignInEvent, SignInResult } from '@shared/types'
import { PiSignInFlow, type SignInFlowDeps } from '@main/runners/pi/signInFlow'
import type { LoginInteraction } from '@main/runners/pi/signIn'

type Login = (
  providerId: string,
  method: 'oauth' | 'api_key',
  interaction: LoginInteraction,
  signal: AbortSignal,
) => Promise<SignInResult>

function harness(login: Login) {
  const events: SignInEvent[] = []
  const deps: SignInFlowDeps = {
    login,
    openUrl: vi.fn(),
    emit: (event) => events.push(event),
    afterSignIn: vi.fn(async () => {}),
  }
  return { flow: new PiSignInFlow(deps), events, deps }
}

/** Waits until the flow has raised a prompt, and returns it. */
async function nextPrompt(events: SignInEvent[]) {
  for (let i = 0; i < 50; i++) {
    const found = events.find((e) => e.type === 'prompt')
    if (found?.type === 'prompt') return found.prompt
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('no prompt was raised')
}

describe('PiSignInFlow', () => {
  test('runs the login, then re-reads Pi, when it succeeds', async () => {
    const { flow, deps } = harness(async () => ({ ok: true }))
    await expect(flow.start('anthropic', 'oauth')).resolves.toEqual({ ok: true })
    expect(deps.afterSignIn).toHaveBeenCalledOnce()
  })

  test('does not re-read Pi when the sign-in fails', async () => {
    const { flow, deps } = harness(async () => ({ ok: false, message: 'nope' }))
    await expect(flow.start('anthropic', 'oauth')).resolves.toEqual({ ok: false, message: 'nope' })
    expect(deps.afterSignIn).not.toHaveBeenCalled()
  })

  test('sends each question to the window and resumes with the answer', async () => {
    let typed: string | undefined
    const { flow, events } = harness(async (_id, _m, interaction) => {
      typed = await interaction.prompt({ type: 'text', message: 'Paste the code' })
      return { ok: true }
    })

    const started = flow.start('openai-codex', 'oauth')
    const prompt = await nextPrompt(events)
    expect(prompt.question.question).toBe('Paste the code')
    expect(prompt.secret).toBe(false)

    expect(flow.answer(prompt.id, { approved: true, answers: { 'Paste the code': 'abc123' } })).toBe(true)
    await expect(started).resolves.toEqual({ ok: true })
    expect(typed).toBe('abc123')
    expect(events).toContainEqual({ type: 'prompt-closed', id: prompt.id })
  })

  test('flags a password or API key prompt as secret', async () => {
    const { flow, events } = harness(async (_id, _m, interaction) => {
      await interaction.prompt({ type: 'secret', message: 'API key' })
      return { ok: true }
    })
    const started = flow.start('openai', 'api_key')
    const prompt = await nextPrompt(events)
    expect(prompt.secret).toBe(true)
    flow.answer(prompt.id, { approved: true, answers: { 'API key': 'sk-test' } })
    await expect(started).resolves.toEqual({ ok: true })
  })

  test('a refused prompt fails the sign-in with the reason Pi gives', async () => {
    const { flow, events } = harness(async (_id, _m, interaction) => {
      try {
        await interaction.prompt({ type: 'text', message: 'Paste the code' })
        return { ok: true }
      } catch (cause) {
        return { ok: false, message: (cause as Error).message }
      }
    })
    const started = flow.start('openai-codex', 'oauth')
    const prompt = await nextPrompt(events)
    flow.answer(prompt.id, { approved: false })
    await expect(started).resolves.toEqual({ ok: false, message: 'sign-in was cancelled' })
  })

  test('shows device codes as notices, and opens the verification page', async () => {
    const { flow, events, deps } = harness(async (_id, _m, interaction) => {
      interaction.notify({ type: 'device_code', userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device' })
      return { ok: true }
    })
    await flow.start('github-copilot', 'oauth')
    expect(deps.openUrl).toHaveBeenCalledWith('https://github.com/login/device')
    expect(events).toContainEqual({ type: 'notice', text: 'Enter code WDJB-MJHT at https://github.com/login/device' })
  })

  test('refuses a second sign-in while one is running', async () => {
    let finish: () => void = () => {}
    const { flow } = harness(() => new Promise((resolve) => (finish = () => resolve({ ok: true }))))
    const first = flow.start('anthropic', 'oauth')
    await expect(flow.start('openai', 'api_key')).resolves.toMatchObject({ ok: false })
    finish()
    await expect(first).resolves.toEqual({ ok: true })
  })

  test('cancelling closes the open prompt and stops the login', async () => {
    let seenSignal: AbortSignal | undefined
    const { flow, events } = harness(async (_id, _m, interaction, signal) => {
      seenSignal = signal
      try {
        await interaction.prompt({ type: 'text', message: 'Paste the code' })
        return { ok: true }
      } catch {
        return { ok: false, message: 'Sign-in was cancelled.' }
      }
    })
    const started = flow.start('openai-codex', 'oauth')
    const prompt = await nextPrompt(events)
    flow.cancel()
    await expect(started).resolves.toEqual({ ok: false, message: 'Sign-in was cancelled.' })
    expect(seenSignal?.aborted).toBe(true)
    expect(events).toContainEqual({ type: 'prompt-closed', id: prompt.id })
  })

  test('an answer for a prompt that is not waiting is ignored', async () => {
    const { flow } = harness(async () => ({ ok: true }))
    expect(flow.answer('nobody', { approved: true })).toBe(false)
  })

  test('keeps only string answers from the window', async () => {
    let received: unknown
    const { flow, events } = harness(async (_id, _m, interaction) => {
      received = await interaction.prompt({ type: 'text', message: 'Q' })
      return { ok: true }
    })
    const started = flow.start('openai', 'api_key')
    const prompt = await nextPrompt(events)
    flow.answer(prompt.id, { approved: true, answers: { Q: 'value', other: 3 as unknown as string } })
    await started
    expect(received).toBe('value')
  })
})
