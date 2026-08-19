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

export interface Filters {
  section?: Section
  domain?: string
  skill?: string
  difficulty?: Difficulty
  status?: 'unseen' | 'wrong' | 'correct' | 'flagged'
}
