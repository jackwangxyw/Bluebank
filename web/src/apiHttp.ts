/**
 * The localhost backend: talks to the Python server, which owns the SQLite
 * database and does the grading.
 *
 * This is the backend where the answer key genuinely stays server-side until
 * you answer. See apiLocal.ts for the static-build counterpart, and api.ts for
 * how one is chosen.
 */
import type {
  Annotation, Filters, GradeResult, Question, SetItem, Stats, TaxonomyRow,
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
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v) as [string, string][],
  )
  return call<{ count: number; questions: SetItem[] }>(`/api/set?${query}`)
}

export function question(id: string) {
  return call<{ question: Question; annotations: Annotation[]; flagged: boolean }>(
    `/api/questions/${encodeURIComponent(id)}`,
  )
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
