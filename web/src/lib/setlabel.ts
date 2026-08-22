/**
 * The one-line name a practice set goes by.
 *
 * Built from the filters the set was created with rather than stored as text,
 * so a set from a month ago never shows a label that no longer means what it
 * says. Lives here rather than beside a component because both the home page
 * and the review page name sets, and a shared helper in a component file
 * breaks fast refresh.
 */
import type { Difficulty, PracticeSet, Section } from '../types'

const SECTION_NAME: Record<Section, string> = {
  RW: 'Reading and Writing',
  MATH: 'Math',
}

const DIFF_NAME: Record<Difficulty, string> = {
  E: 'Easy', M: 'Medium', H: 'Hard',
}

export function describeSet(set: PracticeSet): string {
  const f = set.filters ?? {}
  const parts = [
    `${set.total} question${set.total === 1 ? '' : 's'}`,
    f.section ? SECTION_NAME[f.section] : 'Everything',
  ]
  if (f.difficulties?.length) {
    parts.push(f.difficulties.map((d) => DIFF_NAME[d]).join(' and '))
  }
  if (f.excludeLive) parts.push('no practice-test questions')
  if (f.speed) parts.push(`${f.speed}x time`)
  return parts.join(' · ')
}
