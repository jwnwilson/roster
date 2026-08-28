import { useState } from 'react'
import type { Question } from '@shared/types'

/**
 * An agent's question, answered in the transcript.
 *
 * It arrives as a permission request, but Approve/Deny is the wrong shape for
 * it: allowing a question without an answer just tells the agent nobody
 * replied. So the options are rendered where they were asked and clicking one
 * is what allows the call.
 */
interface QuestionCardProps {
  questions: Question[]
  onAnswer: (answers: Record<string, string>) => void
  /** Allows the call with nothing filled in: the agent is told nobody answered. */
  onSkip: () => void
}

/** What "none of these" is called, per the tool's own contract. */
const OTHER = 'Other'

interface Choice {
  /** Option labels that are on. Several only when the question is multi-select. */
  picked: string[]
  /** Free text, used when the answer is not one of the options. */
  other: string
  otherOpen: boolean
}

const EMPTY: Choice = { picked: [], other: '', otherOpen: false }

export function QuestionCard({ questions, onAnswer, onSkip }: QuestionCardProps) {
  const [choices, setChoices] = useState<Record<string, Choice>>({})

  const choiceFor = (question: string): Choice => choices[question] ?? EMPTY

  function patch(question: string, next: Partial<Choice>): void {
    setChoices((current) => ({
      ...current,
      [question]: { ...choiceFor(question), ...next },
    }))
  }

  /**
   * One click answers when there is nothing else to say — a single question
   * with a single answer. Anything more has to be gathered before sending, or
   * the first click would answer the rest with silence.
   */
  const isOneClick = questions.length === 1 && questions[0]?.multiSelect === false

  function pick(question: Question, label: string): void {
    if (isOneClick) {
      onAnswer({ [question.question]: label })
      return
    }

    const current = choiceFor(question.question)
    const picked = question.multiSelect
      ? toggle(current.picked, label)
      : current.picked[0] === label
        ? []
        : [label]

    patch(question.question, { picked, otherOpen: false })
  }

  const answers = collect(questions, choiceFor)
  const complete = Object.keys(answers).length === questions.length

  return (
    <section
      aria-label="Question from the agent"
      className="flex flex-col gap-[14px] rounded-[9px] border border-accent-line bg-accent-surface-2 px-[15px] py-[13px]"
    >
      {questions.map((question) => {
        const choice = choiceFor(question.question)

        return (
          <div key={question.question} className="flex flex-col gap-[9px]">
            <div className="flex items-baseline gap-[8px]">
              <span className="flex-none rounded-chip border border-accent-line bg-accent-surface px-[7px] py-[1px] font-ui text-2xs font-semibold tracking-[0.04em] text-accent-text uppercase">
                {question.header}
              </span>
              {question.multiSelect ? (
                <span className="flex-none text-sm text-dim">choose any</span>
              ) : null}
            </div>

            <p className="m-0 text-lg leading-[1.5] text-ink">{question.question}</p>

            <div className="flex flex-wrap gap-[7px]">
              {question.options.map((option) => {
                const on = choice.picked.includes(option.label)
                return (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={isOneClick ? undefined : on}
                    title={option.description}
                    onClick={() => pick(question, option.label)}
                    className={`flex max-w-full cursor-pointer flex-col items-start gap-[2px] rounded-field border px-[11px] py-[7px] text-left ${
                      on
                        ? 'border-accent bg-accent-surface text-ink'
                        : 'border-line-input bg-card text-ink-3 hover:border-line-hover-strong'
                    }`}
                    data-hoverable
                  >
                    <span className="font-ui text-md font-medium">{option.label}</span>
                    {option.description === '' ? null : (
                      <span className="max-w-[320px] text-sm leading-[1.45] text-dim-2">
                        {option.description}
                      </span>
                    )}
                  </button>
                )
              })}

              <button
                type="button"
                aria-pressed={choice.otherOpen}
                onClick={() =>
                  patch(question.question, {
                    otherOpen: !choice.otherOpen,
                    ...(choice.otherOpen ? {} : { picked: [] }),
                  })
                }
                className={`cursor-pointer rounded-field border px-[11px] py-[7px] font-ui text-md ${
                  choice.otherOpen
                    ? 'border-accent bg-accent-surface text-ink'
                    : 'border-line-dashed bg-transparent text-muted-2 hover:border-line-hover-strong'
                }`}
                data-hoverable
              >
                {OTHER}…
              </button>
            </div>

            {choice.otherOpen ? (
              <input
                type="text"
                autoFocus
                aria-label={`Your own answer to "${question.question}"`}
                placeholder="Your own answer"
                value={choice.other}
                onChange={(e) => patch(question.question, { other: e.target.value })}
                className="rounded-chip border border-line-input bg-card px-[10px] py-[6px] text-md text-ink outline-none placeholder:text-faint focus:border-accent-line"
              />
            ) : null}
          </div>
        )
      })}

      <div className="flex items-center gap-[9px]">
        <span className="text-sm text-dim">
          {isOneClick ? 'Pick one to answer.' : 'Answer every question, then send.'}
        </span>
        <button
          type="button"
          onClick={onSkip}
          className="ml-auto cursor-pointer rounded-chip border border-line-input bg-transparent px-[11px] py-[4px] font-ui text-md text-muted-2 hover:border-line-hover"
          data-hoverable
        >
          Skip
        </button>
        {isOneClick ? null : (
          <button
            type="button"
            disabled={!complete}
            onClick={() => onAnswer(answers)}
            className="cursor-pointer rounded-chip border-0 bg-accent px-[12px] py-[4px] font-ui text-md font-semibold text-white hover:bg-accent-hover disabled:cursor-default disabled:opacity-40"
          >
            Send answers
          </button>
        )}
      </div>
    </section>
  )
}

/** Multi-select toggles; the array is rebuilt rather than mutated. */
function toggle(picked: readonly string[], label: string): string[] {
  return picked.includes(label)
    ? picked.filter((entry) => entry !== label)
    : [...picked, label]
}

/**
 * The answers so far, keyed by question text — the shape the tool reads back.
 *
 * A question with nothing chosen is left out entirely rather than answered
 * with an empty string, which is what makes "every question answered" a
 * question the caller can ask by counting.
 */
export function collect(
  questions: readonly Question[],
  choiceFor: (question: string) => Choice,
): Record<string, string> {
  const answers: Record<string, string> = {}

  for (const question of questions) {
    const choice = choiceFor(question.question)
    const own = choice.other.trim()

    if (choice.otherOpen && own !== '') answers[question.question] = own
    else if (choice.picked.length > 0) answers[question.question] = choice.picked.join(', ')
  }

  return answers
}
