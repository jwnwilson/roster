import { describe, expect, test } from 'vitest'
import type { Plan, PlanComment } from '@shared/types'
import { planFromToolInput } from '@shared/plans'
import {
  branchFor,
  buildPrompt,
  reviseReason,
  revisePrompt,
  worktreeFor,
} from '@main/sessions/planPrompt'

const PLAN: Plan = {
  id: 'a3f9c0d1-2222-3333-4444-555566667777',
  sessionId: 's1',
  agentId: 'debugging',
  title: 'Archive and un-archive projects',
  status: 'draft',
  version: 2,
  createdAt: 0,
  updatedAt: 0,
}

const BODY = '# Archive projects\n\nArchiving keeps the row.\n'

function note(text: string, overrides: Partial<PlanComment> = {}): PlanComment {
  return {
    id: 'c1',
    planId: PLAN.id,
    author: 'You',
    tone: 'you',
    text,
    version: 2,
    createdAt: 0,
    ...overrides,
  }
}

describe('the branch a plan is built on', () => {
  test('names the plan so it can be found later', () => {
    expect(branchFor(PLAN)).toBe('roster/plan-a3f9c0-archive-and-un-archive-projects')
  })

  test('two plans never collide, however alike their titles', () => {
    const other: Plan = { ...PLAN, id: 'bbbbbbbb-2222-3333-4444-555566667777' }

    expect(branchFor(other)).not.toBe(branchFor(PLAN))
  })

  test('a title git could not take becomes one it can', () => {
    const awkward: Plan = { ...PLAN, title: '  Fix the 504 / pool leak!!  ' }

    // No spaces, no punctuation, no double separators, nothing trailing.
    expect(branchFor(awkward)).toBe('roster/plan-a3f9c0-fix-the-504-pool-leak')
  })

  test('a very long title is cut rather than carried whole', () => {
    const long: Plan = { ...PLAN, title: 'a'.repeat(200) }
    const [, name] = branchFor(long).split('/')

    expect(name!.length).toBeLessThanOrEqual(60)
  })

  test('a title with nothing usable in it still yields a branch', () => {
    const symbols: Plan = { ...PLAN, title: '!!! ???' }

    expect(branchFor(symbols)).toBe('roster/plan-a3f9c0')
  })

  test('the worktree is named after the branch, under roster’s own directory', () => {
    expect(worktreeFor(PLAN)).toMatch(/\/worktrees\/plan-a3f9c0-archive-and-un-archive-projects$/)
  })
})

describe('the prompt that asks for a revision', () => {
  test('carries the notes and the plan as it stands', () => {
    const prompt = revisePrompt({ plan: PLAN, body: BODY, comments: [note('use a timestamp')] })

    expect(prompt).toContain('use a timestamp')
    expect(prompt).toContain(BODY)
  })

  test('leaves out the agent’s own thread lines', () => {
    const prompt = revisePrompt({
      plan: PLAN,
      body: BODY,
      comments: [note('Revised the plan — v2.', { tone: 'agent', author: 'debugging' })],
    })

    // Reading its own log back to itself is noise, not instruction.
    expect(prompt).not.toContain('Revised the plan')
  })

  test('leaves out notes already answered by this version', () => {
    const prompt = revisePrompt({
      plan: PLAN,
      body: BODY,
      comments: [note('old point', { version: 1 }), note('new point')],
    })

    expect(prompt).toContain('new point')
    expect(prompt).not.toContain('old point')
  })

  test('names the passage a note is about', () => {
    const prompt = revisePrompt({
      plan: PLAN,
      body: BODY,
      comments: [note('make this nullable', { quote: 'Archiving keeps the row.' })],
    })

    // Without the passage the agent has to guess which part "this" is.
    expect(prompt).toContain('Archiving keeps the row.')
    expect(prompt).toContain('make this nullable')
  })

  test('a note about the plan as a whole quotes nothing at it', () => {
    const prompt = revisePrompt({ plan: PLAN, body: BODY, comments: [note('too vague')] })

    expect(prompt).toContain('- too vague')
    expect(prompt).not.toMatch(/On “/)
  })

  test('asks for a plan rather than for the work', () => {
    const prompt = revisePrompt({ plan: PLAN, body: BODY, comments: [note('x')] })

    expect(prompt).toMatch(/ExitPlanMode/)
  })
})

describe('the prompt that asks for the work', () => {
  const prompt = buildPrompt({ plan: PLAN, body: BODY, comments: [note('keep the tasks')] })

  test('sends the agent to a worktree rather than the checkout it is sitting in', () => {
    expect(prompt).toContain('git worktree add')
    expect(prompt).toContain(worktreeFor(PLAN))
    expect(prompt).toContain(branchFor(PLAN))
  })

  test('asks for a pull request whose body is the plan', () => {
    expect(prompt).toMatch(/pull request/i)
    expect(prompt).toContain(BODY)
  })

  test('says how to report the pull request back', () => {
    expect(prompt).toContain('mcp__plans__record_pull_request')
    expect(prompt).toContain(PLAN.id)
  })

  test('carries any note left with the approval', () => {
    expect(prompt).toContain('keep the tasks')
  })

  test('carries the passage a note was about', () => {
    const anchored = buildPrompt({
      plan: PLAN,
      body: BODY,
      comments: [note('keep these', { quote: 'Archiving keeps the row.' })],
    })

    expect(anchored).toContain('Archiving keeps the row.')
  })

  test('says nothing about notes when there are none', () => {
    const bare = buildPrompt({ plan: PLAN, body: BODY, comments: [] })

    expect(bare).not.toMatch(/review notes/i)
  })
})

describe('reading a plan out of a tool call', () => {
  test('takes the plan when there is one', () => {
    expect(planFromToolInput(JSON.stringify({ plan: '# Do it' }))).toBe('# Do it')
  })

  test('refuses anything that is not a plan', () => {
    // All of these have reached a CLI boundary at some point; none is a plan.
    expect(planFromToolInput(undefined)).toBeNull()
    expect(planFromToolInput('not json')).toBeNull()
    expect(planFromToolInput('null')).toBeNull()
    expect(planFromToolInput('"a string"')).toBeNull()
    expect(planFromToolInput(JSON.stringify({ plan: 42 }))).toBeNull()
    expect(planFromToolInput(JSON.stringify({ plan: '   ' }))).toBeNull()
    expect(planFromToolInput(JSON.stringify({ other: 'x' }))).toBeNull()
  })
})

describe('the reason a plan is refused', () => {
  test('carries the passage, since that is most of what the note means', () => {
    const reason = reviseReason({
      plan: PLAN,
      body: BODY,
      comments: [note('make this nullable', { quote: 'Archiving keeps the row.' })],
    })

    expect(reason).toContain('Archiving keeps the row.')
    expect(reason).toContain('make this nullable')
  })

  test('still leaves the plan itself out — the agent is holding it', () => {
    const reason = reviseReason({ plan: PLAN, body: BODY, comments: [note('x')] })

    expect(reason).not.toContain(BODY)
  })
})
