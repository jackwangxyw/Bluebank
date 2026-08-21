/**
 * The static backend: no server at all.
 *
 * Fetches straight from College Board, normalises and grades in the browser,
 * and keeps everything in IndexedDB. This is what runs on GitHub Pages.
 *
 * Loading is deliberately two-tier, and that is the whole point of the design:
 *
 *   - The INDEX is two requests and about 1.7 seconds for all 3,770 entries.
 *     It carries id, section, domain, skill, difficulty and band, which is
 *     everything the home page, the filters and the navigator need. The app is
 *     fully usable once this lands.
 *   - A question BODY is one request, fetched when you actually navigate to it
 *     and then cached forever.
 *
 * Fetching all 3,767 bodies up front is what took five minutes. It is not
 * necessary: you only ever download the questions you look at.
 *
 * Two honest limitations versus the localhost backend:
 *   1. The answer key necessarily lives in the browser. It is kept out of
 *      React state by `strip()` below, but it is in IndexedDB and anyone who
 *      wants it can read it. There is no server to withhold it.
 *   2. Progress here is entirely separate from the localhost SQLite database.
 */
import { grade } from './lib/grading'
import { normaliseQuestion, type Stub } from './lib/normalize'
import { byShuffleKey } from './lib/shuffle'
import * as cb from './lib/cbApi'
import * as store from './lib/store'
import * as sync from './lib/sync'
import type {
  Annotation, Filters, GradeResult, Mistake, MistakeTag, Question, SetItem,
  Stats, StoredQuestion, TaxonomyRow,
} from './types'

/** How many questions ahead to warm the cache while you read the current one. */
const PREFETCH = 4

interface Cache {
  stubs: Stub[]
  attempts: Map<string, store.Attempt[]>
  flagged: Set<string>
}

let cache: Cache | null = null
let booting: Promise<Cache> | null = null

const INDEX_AGE_KEY = 'index.fetchedAt'
/**
 * How long a cached index is trusted before it is re-read in the background.
 *
 * The index is what every count in the app is derived from, including "3,767
 * questions" on Home. Without this it was fetched once, on the first ever visit,
 * and then never again: College Board could add a hundred questions and the
 * number would stay frozen on that device forever. Seven days is arbitrary but
 * the bank changes a couple of times a year, so anything in that range is fine.
 */
const INDEX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Index first, bodies later. Everything below waits on this. */
async function boot(): Promise<Cache> {
  if (cache) return cache
  if (booting) return booting
  booting = (async () => {
    store.requestPersistence().catch(() => {})

    let stubs = await store.loadIndex()
    if (!stubs.length) {
      stubs = await cb.fetchIndex()
      await store.saveIndex(stubs)
      await store.setMeta(INDEX_AGE_KEY, Date.now())
    } else {
      // Stale index: refresh AFTER boot resolves, never before. Blocking here
      // would put 1.7s on a cold start to pick up a change the bank makes about
      // twice a year. The new count lands on the next visit.
      const fetchedAt = (await store.getMeta<number>(INDEX_AGE_KEY)) ?? 0
      if (Date.now() - fetchedAt > INDEX_MAX_AGE_MS) {
        queueMicrotask(() => { void refreshIndex().catch(() => {}) })
      }
    }

    const { attempts, flagged } = await readProgress()
    cache = { stubs, attempts, flagged }
    return cache
  })()
  return booting
}

/** The two progress maps, read fresh from IndexedDB. */
async function readProgress() {
  const attempts = new Map<string, store.Attempt[]>()
  for (const attempt of await store.loadAttempts()) {
    const list = attempts.get(attempt.question_id)
    if (list) list.push(attempt)
    else attempts.set(attempt.question_id, [attempt])
  }
  for (const list of attempts.values()) list.sort((a, b) => a.answered_at - b.answered_at)

  const flagged = new Set<string>()
  for (const mark of await store.loadMarks()) {
    if (mark.flagged) flagged.add(mark.question_id)
  }
  return { attempts, flagged }
}

/**
 * Rebuild the in-memory progress maps from IndexedDB.
 *
 * Sync writes attempts and marks straight to the object stores, so without this
 * the cache below still held only what THIS tab had written: answers pulled
 * from another device were invisible to taxonomy() and stats() until a reload.
 */
export async function reloadProgress(): Promise<void> {
  if (!cache) return
  const { attempts, flagged } = await readProgress()
  cache.attempts = attempts
  cache.flagged = flagged
}

// Registered rather than imported the other way round: apiLocal already imports
// sync, and having sync import apiLocal would make the cycle real.
sync.onRemoteData(reloadProgress)

/** Force a re-read of the index from College Board, picking up new questions. */
export async function refreshIndex(): Promise<number> {
  const stubs = await cb.fetchIndex()
  await store.saveIndex(stubs)
  await store.setMeta(INDEX_AGE_KEY, Date.now())
  if (cache) cache.stubs = stubs
  return stubs.length
}

async function loadFull(id: string): Promise<StoredQuestion> {
  const cached = await store.loadQuestion(id)
  if (cached) return cached
  const { stubs } = await boot()
  const stub = stubs.find((s) => s._id === id)
  if (!stub) throw new Error(`unknown question ${id}`)
  const raw = await cb.fetchDetail(stub)
  const question = normaliseQuestion(stub, raw)
  await store.saveQuestion(question)
  return question
}

/** Best-effort cache warming. A failure here must never surface to the user. */
function prefetch(ids: string[]): void {
  for (const id of ids) loadFull(id).catch(() => {})
}

/**
 * Drop the answer key before the question reaches React.
 *
 * This mirrors the shape the HTTP backend sends and keeps the key out of
 * component state and the React devtools tree. It is not a security boundary:
 * the record is still in IndexedDB. On a static site it cannot be.
 */
function strip(q: StoredQuestion): Question {
  const { correct, explanations, rationale_html, flags, ...rest } = q
  void correct; void explanations; void rationale_html; void flags
  return rest
}

function lastAttempt(c: Cache, id: string): store.Attempt | null {
  const list = c.attempts.get(id)
  return list?.length ? list[list.length - 1] : null
}

/** OR within a filter, AND between filters. An empty list is not a filter. */
export const anyOf = <T,>(list: T[] | undefined, value: T | undefined): boolean =>
  !list?.length || (value !== undefined && list.includes(value))

function matches(stub: Stub, c: Cache, f: Filters): boolean {
  if (f.section && stub._section !== f.section) return false
  if (!anyOf(f.domains, stub.primary_class_cd)) return false
  if (!anyOf(f.skills, stub.skill_cd)) return false
  if (!anyOf(f.difficulties, stub.difficulty)) return false

  if (f.statuses?.length) {
    const last = lastAttempt(c, stub._id)
    const hit = f.statuses.some((s) => (
      s === 'unseen' ? !last
        : s === 'wrong' ? last?.correct === 0
          : s === 'correct' ? last?.correct === 1
            : c.flagged.has(stub._id)))
    if (!hit) return false
  }
  return true
}

function toSetItem(stub: Stub, c: Cache): SetItem {
  const list = c.attempts.get(stub._id) ?? []
  const last = list.length ? list[list.length - 1] : null
  return {
    id: stub._id,
    section: stub._section,
    domain: stub.primary_class_cd ?? '',
    domain_name: stub.primary_class_cd_desc ?? '',
    skill: stub.skill_cd ?? '',
    skill_name: stub.skill_desc ?? '',
    difficulty: stub.difficulty ?? ('' as SetItem['difficulty']),
    band: stub.score_band_range_cd ?? null,
    // The index does not say whether an item is MCQ or SPR; only the body does.
    // The navigator does not use this, and QuestionView reads the real type off
    // the loaded question, so reporting mcq here is safe.
    type: 'mcq',
    last_correct: last ? last.correct : null,
    last_seconds: last ? last.seconds : null,
    last_response: last ? last.response : null,
    answered_at: last ? last.answered_at : null,
    flagged: c.flagged.has(stub._id) ? 1 : 0,
    attempt_count: list.length,
  }
}

export async function taxonomy(): Promise<{ taxonomy: TaxonomyRow[]; stats: Stats }> {
  const c = await boot()
  const rows = new Map<string, TaxonomyRow>()
  for (const stub of c.stubs) {
    const key = [stub._section, stub.primary_class_cd, stub.skill_cd, stub.difficulty].join('|')
    let row = rows.get(key)
    if (!row) {
      row = {
        section: stub._section,
        domain: stub.primary_class_cd ?? '',
        domain_name: stub.primary_class_cd_desc ?? '',
        skill: stub.skill_cd ?? '',
        skill_name: stub.skill_desc ?? '',
        difficulty: stub.difficulty ?? ('' as TaxonomyRow['difficulty']),
        n: 0, seen: 0, correct: 0,
      }
      rows.set(key, row)
    }
    row.n++
    const last = lastAttempt(c, stub._id)
    if (last) {
      row.seen++
      row.correct += last.correct
    }
  }
  return { taxonomy: [...rows.values()], stats: await stats() }
}

export async function questionSet(filters: Filters):
    Promise<{ count: number; questions: SetItem[] }> {
  const c = await boot()
  const questions = c.stubs
    .filter((stub) => matches(stub, c, filters))
    .map((stub) => toSetItem(stub, c))
    .sort(byShuffleKey)
  return { count: questions.length, questions }
}

export async function question(id: string): Promise<{
  question: Question; annotations: Annotation[]; flagged: boolean
  mistake: Mistake | null
}> {
  const c = await boot()
  const full = await loadFull(id)

  const position = c.stubs.findIndex((s) => s._id === id)
  if (position >= 0) {
    prefetch(c.stubs.slice(position + 1, position + 1 + PREFETCH).map((s) => s._id))
  }

  const saved = await store.loadAnnotations(id)
  const logged = await store.loadMistake(id)
  return {
    question: strip(full),
    annotations: saved?.items ?? [],
    flagged: c.flagged.has(id),
    mistake: store.isEmptyMistake(logged) ? null : {
      tags: logged!.tags, note: logged!.note, updated_at: logged!.updated_at,
    },
  }
}

export async function saveMistake(
  id: string, tags: MistakeTag[], note: string | null,
): Promise<{ mistake: Mistake | null }> {
  await store.saveMistake(id, tags, note)
  sync.track('mistake', id)
  const saved = await store.loadMistake(id)
  return {
    mistake: store.isEmptyMistake(saved) ? null : {
      tags: saved!.tags, note: saved!.note, updated_at: saved!.updated_at,
    },
  }
}

/** Every question with at least one attempt, most recently answered first. */
export async function reviewed(): Promise<{ questions: SetItem[] }> {
  const c = await boot()
  const questions = c.stubs
    .filter((stub) => Boolean(lastAttempt(c, stub._id)))
    .map((stub) => toSetItem(stub, c))
    .sort((a, b) => (b.answered_at ?? 0) - (a.answered_at ?? 0))
  return { questions }
}

/** Re-grade a stored response for its explanation. Records nothing. */
export async function explain(id: string, response: string | null): Promise<GradeResult> {
  return grade(await loadFull(id), response)
}

export async function answer(
  id: string, response: string | null, seconds: number,
): Promise<GradeResult> {
  const c = await boot()
  const full = await loadFull(id)
  const result = grade(full, response)

  const attempt: store.Attempt = {
    id: crypto.randomUUID(),
    question_id: id,
    answered_at: Math.floor(Date.now() / 1000),
    response,
    correct: result.correct ? 1 : 0,
    seconds,
  }
  await store.saveAttempt(attempt)
  sync.track('attempt', attempt.id)
  const list = c.attempts.get(id)
  if (list) list.push(attempt)
  else c.attempts.set(id, [attempt])

  return result
}

export async function flag(id: string, flagged: boolean): Promise<{ flagged: boolean }> {
  const c = await boot()
  await store.saveMark(id, flagged)
  sync.track('mark', id)
  if (flagged) c.flagged.add(id)
  else c.flagged.delete(id)
  return { flagged }
}

export async function saveAnnotations(id: string, annotations: Annotation[]):
    Promise<{ annotations: Annotation[] }> {
  // Ids are assigned here rather than by a database autoincrement.
  const items = annotations.map((a, i) => ({ ...a, id: a.id ?? i + 1 }))
  await store.saveAnnotations(id, items)
  sync.track('annotation', id)
  return { annotations: items }
}

export async function stats(): Promise<Stats> {
  const c = await boot()
  let attempts = 0
  let correct = 0
  const byDomain = new Map<string, { domain: string; domain_name: string; n: number; c: number }>()

  for (const stub of c.stubs) {
    const last = lastAttempt(c, stub._id)
    if (!last) continue
    attempts++
    correct += last.correct
    const key = stub.primary_class_cd ?? ''
    const row = byDomain.get(key)
      ?? { domain: key, domain_name: stub.primary_class_cd_desc ?? '', n: 0, c: 0 }
    row.n++
    row.c += last.correct
    byDomain.set(key, row)
  }

  return {
    attempts,
    correct,
    accuracy: attempts ? correct / attempts : null,
    by_domain: [...byDomain.values()].sort((a, b) => b.n - a.n),
  }
}
