import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { Question } from '@shared/types'
import { QuestionCard } from '@/chat/QuestionCard'

const CACHE: Question = {
  question: 'Which cache backend?',
  header: 'Cache',
  multiSelect: false,
  options: [
    { label: 'Redis', description: 'Distributed, for multi-instance deployments' },
    { label: 'In-memory', description: 'Fast, single instance only' },
  ],
}

const REGION: Question = {
  question: 'Which regions?',
  header: 'Regions',
  multiSelect: true,
  options: [
    { label: 'us-east-1', description: '' },
    { label: 'eu-west-1', description: '' },
    { label: 'ap-south-1', description: '' },
  ],
}

function card(questions: Question[], onAnswer = vi.fn(), onSkip = vi.fn()) {
  render(<QuestionCard questions={questions} onAnswer={onAnswer} onSkip={onSkip} />)
  return { onAnswer, onSkip }
}

describe('QuestionCard', () => {
  test('draws the question, its chip, and a button per option', () => {
    card([CACHE])

    expect(screen.getByText('Which cache backend?')).toBeInTheDocument()
    expect(screen.getByText('Cache')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Redis/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /In-memory/ })).toBeInTheDocument()
  })

  test("shows each option's description, since that is what the choice means", () => {
    card([CACHE])

    expect(screen.getByText('Distributed, for multi-instance deployments')).toBeInTheDocument()
  })

  test('one question, one answer: clicking answers immediately', async () => {
    const user = userEvent.setup()
    const { onAnswer } = card([CACHE])

    await user.click(screen.getByRole('button', { name: /Redis/ }))

    // Keyed by question text — the shape the tool reads its answers back from.
    expect(onAnswer).toHaveBeenCalledWith({ 'Which cache backend?': 'Redis' })
  })

  test('there is nothing to send when one click is the whole answer', () => {
    card([CACHE])

    expect(screen.queryByRole('button', { name: 'Send answers' })).not.toBeInTheDocument()
  })

  test('several questions gather first, so the first click cannot answer the rest', async () => {
    const user = userEvent.setup()
    const { onAnswer } = card([CACHE, REGION])

    await user.click(screen.getByRole('button', { name: /Redis/ }))

    expect(onAnswer).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Send answers' })).toBeDisabled()
  })

  test('sending is refused until every question has an answer', async () => {
    const user = userEvent.setup()
    const { onAnswer } = card([CACHE, REGION])

    await user.click(screen.getByRole('button', { name: /Redis/ }))
    await user.click(screen.getByRole('button', { name: 'us-east-1' }))
    await user.click(screen.getByRole('button', { name: 'Send answers' }))

    expect(onAnswer).toHaveBeenCalledWith({
      'Which cache backend?': 'Redis',
      'Which regions?': 'us-east-1',
    })
  })

  test('a multi-select question keeps every option chosen', async () => {
    const user = userEvent.setup()
    const { onAnswer } = card([REGION])

    await user.click(screen.getByRole('button', { name: 'us-east-1' }))
    await user.click(screen.getByRole('button', { name: 'ap-south-1' }))
    await user.click(screen.getByRole('button', { name: 'Send answers' }))

    expect(onAnswer).toHaveBeenCalledWith({ 'Which regions?': 'us-east-1, ap-south-1' })
  })

  test('clicking a chosen option again takes it back', async () => {
    const user = userEvent.setup()
    card([REGION])

    await user.click(screen.getByRole('button', { name: 'us-east-1' }))
    expect(screen.getByRole('button', { name: 'us-east-1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'us-east-1' }))
    expect(screen.getByRole('button', { name: 'us-east-1' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: 'Send answers' })).toBeDisabled()
  })

  test('a single-select question holds one answer at a time', async () => {
    const user = userEvent.setup()
    const { onAnswer } = card([CACHE, REGION])

    await user.click(screen.getByRole('button', { name: /Redis/ }))
    await user.click(screen.getByRole('button', { name: /In-memory/ }))
    await user.click(screen.getByRole('button', { name: 'us-east-1' }))
    await user.click(screen.getByRole('button', { name: 'Send answers' }))

    expect(onAnswer).toHaveBeenCalledWith({
      'Which cache backend?': 'In-memory',
      'Which regions?': 'us-east-1',
    })
  })

  test('Other takes an answer none of the options offered', async () => {
    const user = userEvent.setup()
    const { onAnswer } = card([REGION])

    await user.click(screen.getByRole('button', { name: 'Other…' }))
    await user.type(screen.getByLabelText(/Your own answer to/), 'sa-east-1')
    await user.click(screen.getByRole('button', { name: 'Send answers' }))

    expect(onAnswer).toHaveBeenCalledWith({ 'Which regions?': 'sa-east-1' })
  })

  test('an empty Other is not an answer', async () => {
    const user = userEvent.setup()
    card([REGION])

    await user.click(screen.getByRole('button', { name: 'Other…' }))

    expect(screen.getByRole('button', { name: 'Send answers' })).toBeDisabled()
  })

  test('Other replaces what was chosen rather than adding to it', async () => {
    const user = userEvent.setup()
    const { onAnswer } = card([REGION])

    await user.click(screen.getByRole('button', { name: 'us-east-1' }))
    await user.click(screen.getByRole('button', { name: 'Other…' }))
    await user.type(screen.getByLabelText(/Your own answer to/), 'sa-east-1')
    await user.click(screen.getByRole('button', { name: 'Send answers' }))

    expect(onAnswer).toHaveBeenCalledWith({ 'Which regions?': 'sa-east-1' })
  })

  test('choosing an option again after opening Other goes back to the option', async () => {
    const user = userEvent.setup()
    const { onAnswer } = card([REGION])

    await user.click(screen.getByRole('button', { name: 'Other…' }))
    await user.type(screen.getByLabelText(/Your own answer to/), 'sa-east-1')
    await user.click(screen.getByRole('button', { name: 'eu-west-1' }))
    await user.click(screen.getByRole('button', { name: 'Send answers' }))

    expect(onAnswer).toHaveBeenCalledWith({ 'Which regions?': 'eu-west-1' })
  })

  test('Skip answers nothing, deliberately', async () => {
    const user = userEvent.setup()
    const { onSkip, onAnswer } = card([CACHE])

    await user.click(screen.getByRole('button', { name: 'Skip' }))

    expect(onSkip).toHaveBeenCalledTimes(1)
    expect(onAnswer).not.toHaveBeenCalled()
  })

  test('says that several may be chosen, since the buttons look the same', () => {
    card([REGION])

    expect(screen.getByText('choose any')).toBeInTheDocument()
  })
})
