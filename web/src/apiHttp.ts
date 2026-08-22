/**
 * The localhost backend: talks to the Python server, which owns the SQLite
 * database and does the grading.
 *
 * This is the backend where the answer key genuinely stays server-side until
 * you answer. See apiLocal.ts for the static-build counterpart, and api.ts for
 * how one is chosen.
 */
import type {
  Annotation, Attempt, Filters, GradeResult, Mistake, MistakeTag, PracticeSet,
  Question, SetAnswer, SetItem, Stats, TaxonomyRow,
} from './types'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error ?? `${response.status} ${path}`)
  return data as T
}

export function taxonomy() {
  return call<{ taxonomy: TaxonomyRow[]; stats: Stats }>('/api/taxonomy')
}

export function questionSet(filters: Filters) {
  // Repeated keys rather than a comma-joined string, so a value that ever
  // contains a comma cannot split into two filters. server.py reads them all.
  const query = new URLSearchParams()
  if (filters.section) query.set('section', filters.section)
  for (const d of filters.domains ?? []) query.append('domain', d)
  for (const s of filters.skills ?? []) query.append('skill', s)
  for (const d of filters.difficulties ?? []) query.append('difficulty', d)
  for (const s of filters.statuses ?? []) query.append('status', s)
  if (filters.excludeLive) query.set('exclude_live', '1')
  return call<{ count: number; questions: SetItem[] }>(`/api/set?${query}`)
}

export function saveMistake(id: string, tags: MistakeTag[], note: string | null) {
  return call<{ mistake: Mistake | null }>(`/api/mistake/${id}`, {
    method: 'POST',
    body: JSON.stringify({ tags, note }),
  })
}

/** Every question with at least one attempt, most recently answered first. */
export function reviewed() {
  return call<{ count: number; questions: SetItem[] }>(
    '/api/set?status=correct&status=wrong&order=recent')
}

export function question(id: string) {
  return call<{
    question: Question; annotations: Annotation[]; flagged: boolean
    mistake: Mistake | null
  }>(
    `/api/questions/${encodeURIComponent(id)}`,
  )
}

/** Ids of every question with a mistake log, for Review's filter. */
export function loggedIds() {
  return call<{ question_ids: string[] }>('/api/mistakes')
}

/** Every attempt at one question, oldest first. */
export function attemptsFor(id: string) {
  return call<{ attempts: Attempt[] }>(
    `/api/questions/${encodeURIComponent(id)}/attempts`)
}

/** Re-grade a stored response for its explanation. Records nothing. */
export function explain(id: string, response: string | null) {
  return call<GradeResult>(`/api/questions/${encodeURIComponent(id)}/explain`, {
    method: 'POST',
    body: JSON.stringify({ response }),
  })
}

export function answer(id: string, response: string | null, seconds: number) {
  return call<GradeResult>(`/api/questions/${encodeURIComponent(id)}/answer`, {
    method: 'POST',
    body: JSON.stringify({ response, seconds }),
  })
}

export function flag(id: string, flagged: boolean) {
  return call<{ flagged: boolean }>(`/api/questions/${encodeURIComponent(id)}/flag`, {
    method: 'POST',
    body: JSON.stringify({ flagged }),
  })
}

export function saveAnnotations(id: string, annotations: Annotation[]) {
  return call<{ annotations: Annotation[] }>(
    `/api/questions/${encodeURIComponent(id)}/annotations`,
    { method: 'PUT', body: JSON.stringify({ annotations }) },
  )
}

export function stats() {
  return call<Stats>('/api/stats')
}

// ------------------------------------------------------------- practice sets

/** `active` undefined lists both; true is unfinished, false is finished. */
export function listSets(active?: boolean, limit = 50) {
  const query = new URLSearchParams({ limit: String(limit) })
  if (active !== undefined) query.set('active', active ? '1' : '0')
  return call<{ sets: PracticeSet[] }>(`/api/sets?${query}`).then((d) => d.sets)
}

export function getSet(id: string) {
  return call<{ set: PracticeSet }>(`/api/sets/${encodeURIComponent(id)}`)
    .then((d) => d.set)
}

/** Create or update. The whole row goes up; the server guards on updated_at. */
export function saveSet(set: SetInput) {
  return call<{ set: PracticeSet }>('/api/sets', {
    method: 'POST',
    body: JSON.stringify({ ...set, updated_at: Date.now() }),
  }).then((d) => d.set)
}

export function deleteSet(id: string) {
  return call<{ deleted: string }>(
    `/api/sets/${encodeURIComponent(id)}/delete`, { method: 'POST' },
  ).then(() => undefined)
}

export interface SetInput {
  id: string
  created_at: number
  finished_at: number | null
  seconds: number
  filters: Filters
  items: SetAnswer[]
}
