/**
 * How long a practice set gets.
 *
 * The real digital SAT gives each module its own clock: Reading and Writing is
 * 32 minutes for 27 questions, Math is 35 minutes for 22. That works out at
 * 71.1 and 95.5 seconds a question, and those two numbers are the whole basis
 * of the timer here.
 *
 * A set is timed per question rather than per module because a set is not a
 * module: it can be any length and it can mix the sections. Summing each
 * question's own allowance is the only version of "the time you would get on
 * the day" that survives a 13 question set of half Math.
 */
import type { Section } from '../types'

/** Minutes and questions per module on the real test. */
export const MODULE = {
  RW: { minutes: 32, questions: 27 },
  MATH: { minutes: 35, questions: 22 },
} as const

export const SECONDS_PER_QUESTION: Record<Section, number> = {
  RW: (MODULE.RW.minutes * 60) / MODULE.RW.questions,
  MATH: (MODULE.MATH.minutes * 60) / MODULE.MATH.questions,
}

/**
 * The pace multipliers offered, applied to the time rather than to the pace.
 * 0.75x is three quarters of the real allowance and so is the hard one; 1.5x
 * is half again as long.
 */
export const SPEEDS = [0.75, 1, 1.25, 1.5] as const
export type Speed = (typeof SPEEDS)[number]

export const DEFAULT_SPEED: Speed = 1

/**
 * Seconds for a whole set, rounded to the minute so the clock starts on
 * something a person would say out loud.
 *
 * Returns 0 for an empty set, which reads as "no timer" everywhere above this.
 */
export function setSeconds(sections: Section[], speed: number): number {
  if (!sections.length || !speed) return 0
  const raw = sections.reduce((total, s) => total + SECONDS_PER_QUESTION[s], 0)
  return Math.round((raw * speed) / 60) * 60
}

/**
 * "1m 20s", because 80s is harder to read at a glance.
 *
 * The spelled-out form the review screens use. `formatClock` is the running
 * clock, which has to stay a fixed shape while it ticks; this one is read once,
 * sitting still, so it can spend the extra characters.
 */
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/** `m:ss`, or `h:mm:ss` once a set is long enough to need it. */
export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return (h ? `${h}:` : '') + `${mm}:${String(s).padStart(2, '0')}`
}
