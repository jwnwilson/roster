import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  forgetProvider,
  isModelUnavailable,
  markAvailable,
  markUnavailable,
  unavailableModels,
} from '@main/runners/pi/availability'
import { explainSignInFailure, explainUnavailableModel, SIGN_IN_TOOL } from '@main/runners/pi/signIn'
import { isSessionGrantable } from '@main/sessions/manager'

let home: string
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'roster-avail-'))
  process.env['ROSTER_HOME'] = home
})
afterEach(async () => {
  delete process.env['ROSTER_HOME']
  await rm(home, { recursive: true, force: true })
})

const CODEX_REFUSAL = "Codex error: The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account."

describe('model availability', () => {
  test('recognises an account being refused a model, and nothing transient', () => {
    expect(isModelUnavailable(CODEX_REFUSAL)).toBe(true)
    expect(isModelUnavailable('You do not have access to the model gpt-x')).toBe(true)
    expect(isModelUnavailable('The model `foo` does not exist')).toBe(true)
    expect(isModelUnavailable('429 rate limited')).toBe(false)
    expect(isModelUnavailable('401 Unauthorized')).toBe(false)
  })

  test('remembers refusals, un-marks a model that works, and forgets a provider', () => {
    expect(unavailableModels()).toEqual({})
    markUnavailable('openai-codex/gpt-6-sol', CODEX_REFUSAL, 1)
    markUnavailable('openai-codex/gpt-6-astra', CODEX_REFUSAL, 2)
    markUnavailable('xai/grok-4.7', 'nope', 3)
    expect(unavailableModels()['openai-codex/gpt-6-sol']).toEqual({ reason: CODEX_REFUSAL, checkedAt: 1 })

    markAvailable('openai-codex/gpt-6-astra')
    markAvailable('never/seen')
    expect(Object.keys(unavailableModels())).toEqual(['openai-codex/gpt-6-sol', 'xai/grok-4.7'])

    forgetProvider('openai-codex')
    expect(Object.keys(unavailableModels())).toEqual(['xai/grok-4.7'])
  })
})

describe('clearer messages', () => {
  const OPENAI = { id: 'openai', name: 'OpenAI', oauth: 'OpenAI (ChatGPT subscription)' }
  const XAI = { id: 'xai', name: 'xAI', oauth: 'xAI' }

  test('explains invalid_grant as stale browser sign-in, with the Codex route for OpenAI', () => {
    const message = explainSignInFailure(OPENAI, 'OpenAI OAuth token request failed (400): {"error":"invalid_grant"}')
    expect(message).toMatch(/private window/)
    expect(message).toMatch(/Connected apps/)
    expect(message).toMatch(/openai-codex/)
    expect(explainSignInFailure(XAI, 'invalid_grant')).toMatch(/send your message again/)
  })

  test('explains workspace policy, a busy port, cancelling and the network', () => {
    expect(explainSignInFailure(OPENAI, '3p_delegated_access_policy_denied')).toMatch(/workspace admin/)
    expect(explainSignInFailure(OPENAI, 'Port 1455 is in use, probably by …')).toMatch(/another sign-in/)
    expect(explainSignInFailure(OPENAI, 'sign-in was cancelled')).toMatch(/cancelled/)
    expect(explainSignInFailure(OPENAI, 'fetch failed')).toMatch(/could not reach/)
    expect(explainSignInFailure(OPENAI, 'something new')).toBe('Could not sign in to OpenAI: something new')
  })

  test('says an unavailable model is greyed out', () => {
    expect(explainUnavailableModel('openai-codex/gpt-6-sol', CODEX_REFUSAL)).toMatch(
      /^openai-codex\/gpt-6-sol is not available on your account \(The 'gpt-6-sol' model is not supported.*greyed it out/,
    )
  })
})

describe('allow for this session', () => {
  test('applies only to plain permission requests', () => {
    expect(isSessionGrantable({ toolName: 'bash' })).toBe(true)
    expect(isSessionGrantable({ toolName: 'bash', questions: [] })).toBe(false)
    expect(isSessionGrantable({ toolName: 'ExitPlanMode' })).toBe(false)
    expect(isSessionGrantable({ toolName: 'write', planId: 'p' })).toBe(false)
    expect(isSessionGrantable({ toolName: SIGN_IN_TOOL })).toBe(false)
  })
})
