import type { Question, QuestionOption } from '../../../shared/types'

/**
 * Reading an agent's question out of a tool call.
 *
 * A question arrives as a permission request rather than as a normal tool
 * call: the tool's input carries an `answers` field the permission step is
 * expected to fill in, so Roster's approval gate is where a question is
 * answered. That makes parsing its shape a runner concern, not a UI one.
 */

/**
 * What a question tool is asking, in one line, for a row or a banner.
 *
 * Deliberately more forgiving than parseQuestions: a line of text only needs
 * the question, while a row of buttons needs options good enough to click.
 * A malformed call should still read as what it asked rather than as JSON.
 */
export function summariseQuestions(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null

  const first = isRecord(value[0]) ? asText(value[0]['question']) : null
  if (first === null) return null

  const rest = value.length - 1
  return rest === 0 ? first : `${first} (+${rest} more)`
}

/**
 * The questions in a tool call, or null when there is nothing answerable.
 *
 * Validated rather than cast: this drives buttons the user clicks, and a
 * malformed option would render as an empty one that answers nothing. All
 * or nothing — a half-rendered question is worse than falling back to the
 * banner, where allowing and denying both still work.
 */
export function parseQuestions(value: unknown): Question[] | null {
  if (!Array.isArray(value) || value.length === 0) return null

  const parsed: Question[] = []
  for (const entry of value) {
    const question = parseQuestion(entry)
    if (question === null) return null
    parsed.push(question)
  }

  return parsed
}

function parseQuestion(value: unknown): Question | null {
  if (!isRecord(value)) return null

  const question = asText(value['question'])
  if (question === null) return null

  const options = parseOptions(value['options'])
  if (options === null) return null

  return {
    question,
    header: asText(value['header']) ?? question,
    multiSelect: value['multiSelect'] === true,
    options,
  }
}

function parseOptions(value: unknown): QuestionOption[] | null {
  if (!Array.isArray(value) || value.length === 0) return null

  const parsed: QuestionOption[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return null
    const label = asText(entry['label'])
    if (label === null) return null
    parsed.push({ label, description: asText(entry['description']) ?? '' })
  }

  return parsed
}

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
