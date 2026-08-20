/**
 * Auto-grading against the official accepted-answer list. Port of grading.py;
 * tests/grading.test.ts is the same corpus of cases as the Python suite.
 *
 * `correct` is an array of accepted strings and it conflates two different
 * things: alternate spellings of one value (["0.25", "1/4"]) and genuinely
 * different valid answers (["7", "8", "13"] for "a possible value of a").
 * Grading is a membership test either way. The review UI must show every
 * accepted form, never accepted[0].
 */
import { equals, parseRational } from './fraction'
import type { GradeResult, StoredQuestion } from '../types'

// Every dash the bank actually uses where a minus sign is meant.
const MINUS: Record<string, string> = { '−': '-', '–': '-', '—': '-' }

/**
 * Canonical string form: strip whitespace, thousands commas, currency, unicode
 * minus, leading zero, and trailing decimal zeros.
 *
 * The trailing-zero strip is guarded on there being a decimal point. Without
 * that guard "1200" would canonicalise to "12".
 */
export function canonical(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  let s = String(value).trim()
  for (const [bad, good] of Object.entries(MINUS)) s = s.split(bad).join(good)
  s = s.replace(/\s+/g, '').replace(/,/g, '').replace(/\$/g, '')
  if (!s) return ''

  const negative = s.startsWith('-')
  if (negative || s.startsWith('+')) s = s.slice(1)

  if (!s.includes('/') && s.includes('.')) {
    s = s.replace(/0+$/, '').replace(/\.+$/, '') || '0'
    if (s.startsWith('0.') && s.length > 2) s = s.slice(1)
  }
  return (negative && s !== '0' ? '-' : '') + s
}

/** Exact rational value, or null if the string is not a plain number. */
export function asFraction(value: string | number | null | undefined) {
  return parseRational(canonical(value))
}

export type Match = 'listed' | 'equivalent' | null

export function gradeSpr(response: string | null, accepted: string[]): [boolean, Match] {
  const canonResponse = canonical(response)
  if (!canonResponse) return [false, null]
  if (accepted.some((a) => canonResponse === canonical(a))) return [true, 'listed']

  // A student typing 1.5 for a listed 3/2 is right even when the bank only
  // lists one spelling.
  const value = asFraction(response)
  if (value) {
    for (const a of accepted) {
      const other = asFraction(a)
      if (other && equals(other, value)) return [true, 'equivalent']
    }
  }
  return [false, null]
}

export function gradeMcq(response: string | null, accepted: string[]): [boolean, Match] {
  if (response === null || response === undefined) return [false, null]
  const letter = String(response).trim().toUpperCase()
  const hit = accepted.some((a) => String(a).trim().toUpperCase() === letter)
  return [hit, hit ? 'listed' : null]
}

/**
 * Grade one response and assemble the full review payload. Everything returned
 * is official College Board text.
 */
export function grade(question: StoredQuestion, response: string | null): GradeResult {
  const accepted = question.correct
  const isMcq = question.type === 'mcq'
  const [correct, match] = isMcq
    ? gradeMcq(response, accepted)
    : gradeSpr(response, accepted)

  const explanations = question.explanations ?? {}
  const pickedHtml = isMcq && response
    ? explanations[String(response).trim().toUpperCase()] ?? null
    : null
  const keyHtml = isMcq && accepted.length
    ? explanations[String(accepted[0]).trim().toUpperCase()] ?? null
    : null

  return {
    question_id: question.id,
    response,
    correct,
    match,
    accepted: [...accepted],
    why_wrong_html: correct ? null : pickedHtml,
    why_right_html: keyHtml,
    rationale_html: question.rationale_html ?? null,
  }
}
