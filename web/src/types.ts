export type Section = 'RW' | 'MATH'
export type Difficulty = 'E' | 'M' | 'H'
export type QuestionType = 'mcq' | 'spr'

export interface Option {
  label: string
  html: string
}

/** What the API sends before you answer. No key, no rationale. */
export interface Question {
  id: string
  section: Section
  domain: string
  domain_name: string
  skill: string
  skill_name: string
  difficulty: Difficulty
  band: number | null
  type: QuestionType
  stimulus_html: string
  stem_html: string
  options: Option[] | null
  key_recovered: boolean
  source_path: string
}

/**
 * Why you got a question wrong, in your own words.
 *
 * `process` is a method slip, `silly` an execution slip, `knowledge` a gap, and
 * `other` the escape hatch. Tags are a list because a question is often two of
 * them at once.
 */
export const MISTAKE_TAGS = ['process', 'silly', 'knowledge', 'other'] as const
export type MistakeTag = (typeof MISTAKE_TAGS)[number]

export interface Mistake {
  tags: MistakeTag[]
  note: string | null
  updated_at: number
}

/** One row of the working set, enough to draw the navigator. */
export interface SetItem {
  id: string
  section: Section
  domain: string
  domain_name: string
  skill: string
  skill_name: string
  difficulty: Difficulty
  band: number | null
  type: QuestionType
  last_correct: number | null
  last_seconds: number | null
  last_response: string | null
  answered_at: number | null
  flagged: number
  /** Total attempts ever, so the navigator can tell first-try from retry. */
  attempt_count: number
}

/**
 * The full normalised record, key included, as it is stored locally.
 *
 * The HTTP backend deliberately never sends this to the browser before you
 * answer -- `Question` is the withheld shape. On GitHub Pages there is no
 * server to withhold anything, so the key necessarily lives client-side and is
 * only hidden by the UI. That is a real capability difference between the two
 * backends, not an oversight.
 */
export interface StoredQuestion extends Question {
  correct: string[]
  explanations: Record<string, string> | null
  rationale_html: string | null
  flags: string[]
}

export interface Annotation {
  id?: number
  field: string
  start_offset: number
  end_offset: number
  color: string
  note: string | null
}

export interface GradeResult {
  question_id: string
  response: string | null
  correct: boolean
  match: 'listed' | 'equivalent' | null
  accepted: string[]
  why_wrong_html: string | null
  why_right_html: string | null
  rationale_html: string | null
}

export interface TaxonomyRow {
  section: Section
  domain: string
  domain_name: string
  skill: string
  skill_name: string
  difficulty: Difficulty
  n: number
  seen: number
  correct: number
}

export interface Stats {
  attempts: number
  correct: number
  accuracy: number | null
  by_domain: { domain: string; domain_name: string; n: number; c: number }[]
}

export type Status = 'unseen' | 'wrong' | 'correct' | 'flagged'

/**
 * Everything except `section` is a list, and an empty list means "no filter"
 * rather than "nothing matches". Within a row the values are OR'd (medium OR
 * hard); across rows they are AND'd (reading AND (medium OR hard)).
 *
 * `section` stays single because it is the mode you pick on the way in, and
 * "Everything" already covers both.
 *
 * Undefined rather than [] when empty, so the "All" chip has one thing to test.
 */
export interface Filters {
  section?: Section
  domains?: string[]
  skills?: string[]
  difficulties?: Difficulty[]
  statuses?: Status[]
}
