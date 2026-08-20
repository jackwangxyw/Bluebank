/**
 * Turning one raw College Board payload into a StoredQuestion. Port of the
 * normalise pass in pipeline.py.
 *
 * There are two shapes in the bank and they share almost nothing:
 *  - `external_id` items: structured, with `answerOptions` and `correct_answer`.
 *  - `ibn` items: the legacy path. One HTML blob, lowercase choice keys, and
 *    81 of them ship with no answer key at all, which has to be recovered out
 *    of the rationale prose.
 */
import { classify, recoverMcqAnswer, recoverSprAnswers, splitExplanations } from './rationale'
import type { Difficulty, Option, QuestionType, Section, StoredQuestion } from '../types'

/** One row of the index: metadata only, no question body. */
export interface Stub {
  _id: string
  _path: 'external_id' | 'ibn'
  _section: Section
  external_id?: string
  ibn?: string
  questionId?: string
  updateDate?: number
  primary_class_cd?: string
  primary_class_cd_desc?: string
  skill_cd?: string
  skill_desc?: string
  difficulty?: Difficulty
  score_band_range_cd?: number | null
}

interface Normalised {
  type: QuestionType
  stimulus_html: string
  stem_html: string
  options: Option[]
  correct: string[]
  rationale_html: string
  key_recovered: boolean
  flags: string[]
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>

function normaliseExternal(raw: Raw): Normalised {
  const flags: string[] = []
  const rawOptions: Raw[] = raw.answerOptions ?? []
  const options: Option[] = rawOptions.map((opt, i) => ({
    label: String.fromCharCode(65 + i),
    html: opt?.content ?? '',
  }))
  const correct: string[] = [...(raw.correct_answer ?? [])]
  const type: QuestionType = raw.type ?? (options.length ? 'mcq' : 'spr')

  // `keys` holds the option uuid of the answer; it must point at the same
  // option the `correct_answer` letter does.
  if (type === 'mcq' && correct.length && raw.keys?.length) {
    const index = String(correct[0]).trim().toUpperCase().charCodeAt(0) - 65
    if (!(index >= 0 && index < rawOptions.length) || rawOptions[index].id !== raw.keys[0]) {
      flags.push('keys_letter_disagreement')
    }
  }

  if (!correct.length) flags.push('no_answer_key')

  return {
    type,
    stimulus_html: raw.stimulus ?? '',
    stem_html: raw.stem ?? '',
    options,
    correct,
    rationale_html: raw.rationale ?? '',
    key_recovered: false,
    flags,
  }
}

function normaliseIbn(raw: Raw): Normalised {
  const flags: string[] = []
  const answer: Raw = raw.answer ?? {}
  const style = String(answer.style ?? '').trim().toLowerCase()
  const type: QuestionType = style === 'multiple choice' ? 'mcq' : 'spr'

  const choices: Raw = answer.choices ?? {}
  const options: Option[] = Object.keys(choices).sort().map((k) => ({
    label: k.toUpperCase(),
    html: choices[k]?.body ?? '',
  }))
  if (type === 'mcq') {
    const labels = options.map((o) => o.label)
    const expected = labels.map((_, i) => String.fromCharCode(65 + i))
    if (labels.join('') !== expected.join('')) {
      flags.push('unexpected_choice_labels_' + labels.join(''))
    }
  }

  const rationaleHtml: string = answer.rationale ?? ''
  const key = answer.correct_choice
  let keyRecovered = false
  let correct: string[] = []

  if (type === 'mcq') {
    if (key) {
      correct = [String(key).trim().toUpperCase()]
    } else {
      const { letter, flags: rflags } = recoverMcqAnswer(rationaleHtml)
      flags.push(...rflags)
      if (letter) {
        correct = [letter]
        keyRecovered = true
      }
    }
  } else if (key) {
    correct = [String(key).trim()]
  } else {
    const { answers, flags: rflags } = recoverSprAnswers(rationaleHtml)
    flags.push(...rflags)
    if (answers.length) {
      correct = answers
      keyRecovered = true
    }
  }

  if (!correct.length) flags.push('no_answer_key')

  // `body` carries the stimulus (class="stimulus_reference") on the items that
  // have one: the table, figure, or expression the stem refers to. Dropping it
  // leaves questions reading "which of the following is equivalent to the
  // expression above?" with no expression. One item has no `prompt` at all and
  // puts the whole question in `body`.
  let stimulusHtml: string = raw.body ?? ''
  let stemHtml: string = raw.prompt ?? ''
  if (!stemHtml.trim()) {
    stemHtml = stimulusHtml
    stimulusHtml = ''
    if (!stemHtml.trim()) flags.push('empty_stem')
  }

  return {
    type,
    stimulus_html: stimulusHtml,
    stem_html: stemHtml,
    options,
    correct,
    rationale_html: rationaleHtml,
    key_recovered: keyRecovered,
    flags,
  }
}

/**
 * Build the stored record for one question.
 *
 * The cross-check at the end is the important part: exactly one per-choice
 * explanation must read as "correct", and it must be the keyed choice. A
 * handful of items have stale letters in the rationale prose after their
 * options were reordered. Left unguarded, those tell a student who picked D
 * that they were right. When the check fails the per-choice mapping is
 * dropped and the whole rationale is shown instead.
 */
export function normaliseQuestion(stub: Stub, raw: Raw): StoredQuestion {
  const norm = stub._path === 'external_id' ? normaliseExternal(raw) : normaliseIbn(raw)

  let explanations: Record<string, string> | null = null
  if (norm.type === 'mcq' && norm.options.length) {
    const labels = norm.options.map((o) => o.label)
    const split = splitExplanations(norm.rationale_html, labels)
    explanations = split.explanations
    norm.flags.push(...split.flags)

    if (Object.keys(explanations).length && norm.correct.length) {
      const readsCorrect = Object.entries(explanations)
        .filter(([, html]) => classify(html) === 'correct')
        .map(([label]) => label)
      const expected = [norm.correct[0]]
      if (readsCorrect.join('') !== expected.join('')) {
        norm.flags.push(
          'explanation_key_mismatch_rationale_says_' + (readsCorrect.join('') || 'none'),
        )
        explanations = null
      }
    }
  }

  return {
    id: stub._id,
    source_path: stub._path,
    section: stub._section,
    domain: stub.primary_class_cd ?? '',
    domain_name: stub.primary_class_cd_desc ?? '',
    skill: stub.skill_cd ?? '',
    skill_name: stub.skill_desc ?? '',
    difficulty: (stub.difficulty ?? '') as Difficulty,
    band: stub.score_band_range_cd ?? null,
    type: norm.type,
    stimulus_html: norm.stimulus_html,
    stem_html: norm.stem_html,
    options: norm.options.length ? norm.options : null,
    correct: norm.correct,
    rationale_html: norm.rationale_html,
    explanations: explanations && Object.keys(explanations).length ? explanations : null,
    key_recovered: norm.key_recovered,
    flags: norm.flags,
  }
}

/**
 * Collapse the raw index into unique stubs.
 *
 * 3,770 index entries are only 3,767 distinct questions: three external_ids
 * appear twice under different questionIds with different updateDates. Keeping
 * the newest is what makes the refresh check compare against a stable value.
 */
export function dedupeStubs(stubs: Stub[]): Stub[] {
  const unique = new Map<string, Stub>()
  for (const stub of [...stubs].sort((a, b) => (a.updateDate ?? 0) - (b.updateDate ?? 0))) {
    unique.set(stub._id, stub)
  }
  return [...unique.values()]
}

/**
 * Tag an index row with the id and which of the two payload shapes it uses.
 *
 * The unused path field is an empty string, not null, so this tests truthiness
 * rather than presence. Exactly one of the two must be set.
 */
export function tagStub(row: Raw, section: Section): Stub {
  const ext = row.external_id
  const ibn = row.ibn
  if (Boolean(ext) === Boolean(ibn)) {
    throw new Error(
      `stub ${row.questionId}: expected exactly one of external_id/ibn, ` +
      `got ext=${JSON.stringify(ext)} ibn=${JSON.stringify(ibn)}`,
    )
  }
  return { ...row, _id: ext || ibn, _path: ext ? 'external_id' : 'ibn', _section: section } as Stub
}
