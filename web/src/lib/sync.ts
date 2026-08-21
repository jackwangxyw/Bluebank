/**
 * Cloud sync: push what changed locally, pull what changed elsewhere, one
 * round trip.
 *
 * This is a layer ABOVE store.ts, never inside it. Nothing in the app reads or
 * writes through here, so with sync switched off (or the Worker deleted) the
 * app behaves exactly as it did before. That is the anonymous-first guarantee,
 * and it is structural rather than a promise.
 *
 * The merge is easy for one reason: attempts are a grow-only set keyed by uuid.
 * A sync that fails, half-lands, duplicates, or arrives out of order cannot
 * lose or corrupt anything, so there is no reconciliation logic here and none
 * is needed. Marks and annotations are last-write-wins per question, decided
 * server-side.
 */
import * as auth from './auth'
import * as store from './store'
import type { Annotation } from '../types'

export type SyncStatus = 'off' | 'syncing' | 'synced' | 'pending'

const CURSOR_KEY = 'sync.cursor'
const DEBOUNCE_MS = 2000

let status: SyncStatus = 'off'
let lastError: string | null = null
let inFlight: Promise<void> | null = null
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

export const getStatus = (): SyncStatus => status
export const getError = (): string | null => lastError

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function emit(next: SyncStatus, error: string | null = null) {
  status = next
  lastError = error
  for (const listener of listeners) listener()
}

/** Called on every local write. Cheap, and a no-op when signed out. */
export function track(kind: store.OutboxKind, id: string): void {
  if (!auth.configured || !auth.signedIn()) return
  void store.enqueue(kind, id).then(() => schedule())
}

/**
 * Coalesces a burst of answers into one request. The debounce is not about
 * quota (a heavy day is ~100 requests against a five-figure daily allowance),
 * it is so that answering fast does not fire a request every three seconds, and
 * so the network is never on the answer-submission path.
 */
export function schedule(): void {
  if (!auth.configured || !auth.signedIn()) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; void syncNow() }, DEBOUNCE_MS)
}

export function syncNow(): Promise<void> {
  if (!auth.configured || !auth.signedIn()) { emit('off'); return Promise.resolve() }
  if (inFlight) return inFlight
  inFlight = run().finally(() => { inFlight = null })
  return inFlight
}

async function run(): Promise<void> {
  emit('syncing')
  try {
    // Snapshot the outbox first. Only these keys are cleared at the end, so a
    // write that lands mid-request survives to the next sync.
    const keys = await store.loadOutbox()
    const payload = await collect(keys)
    const since = (await store.getMeta<number>(CURSOR_KEY)) ?? 0

    const res = await auth.request('/sync', {
      method: 'POST',
      body: JSON.stringify({ since, ...payload }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error || `Sync failed (${res.status})`)
    }
    const data = await res.json() as ServerResponse

    await apply(data)
    await store.setMeta(CURSOR_KEY, data.cursor)
    await store.clearOutbox(keys)

    const remaining = await store.loadOutbox()
    emit(remaining.length ? 'pending' : 'synced')
    if (remaining.length) schedule()
  } catch (e) {
    // Nothing is cleared on failure, so the outbox still holds everything.
    // Surfaced as amber in the UI rather than swallowed: a sync that silently
    // stops looks identical to one that is switched off.
    emit('pending', (e as Error).message)
  }
}

interface ServerResponse {
  cursor: number
  attempts: store.Attempt[]
  marks: { question_id: string; flagged: number; updated_at: number }[]
  annotations: { question_id: string; items: Annotation[]; updated_at: number }[]
}

async function collect(keys: string[]) {
  const attemptIds = new Set<string>()
  const markIds = new Set<string>()
  const annotationIds = new Set<string>()
  for (const key of keys) {
    const parsed = store.parseOutboxKey(key)
    if (!parsed) continue
    if (parsed.kind === 'attempt') attemptIds.add(parsed.id)
    else if (parsed.kind === 'mark') markIds.add(parsed.id)
    else annotationIds.add(parsed.id)
  }

  const [allAttempts, allMarks, allAnnotations] = await Promise.all([
    attemptIds.size ? store.loadAttempts() : Promise.resolve([]),
    markIds.size ? store.loadMarks() : Promise.resolve([]),
    annotationIds.size ? store.loadAllAnnotations() : Promise.resolve([]),
  ])

  return {
    attempts: allAttempts.filter((a) => attemptIds.has(a.id)),
    marks: allMarks.filter((m) => markIds.has(m.question_id)),
    annotations: allAnnotations.filter((a) => annotationIds.has(a.question_id)),
  }
}

async function apply(data: ServerResponse): Promise<void> {
  // Attempts: union. Re-putting one we already have is a no-op by construction,
  // which is why the server can safely echo our own writes back.
  if (data.attempts?.length) {
    await store.putMany(store.STORE_ATTEMPTS, data.attempts)
  }
  // Marks and annotations arrive already resolved: the server applied the
  // last-write-wins guard, so whatever came back IS the answer and is written
  // verbatim, timestamp included.
  for (const m of data.marks ?? []) await store.putMark(m)
  for (const a of data.annotations ?? []) {
    await store.putAnnotations({ question_id: a.question_id, items: a.items, updated_at: a.updated_at })
  }
}

/**
 * First sync after signing in: queue everything already on this device.
 *
 * This is what keeps a month of anonymous practice when someone finally signs
 * in. Safe by construction, because pushing an attempt the server already has
 * is a no-op.
 */
export async function seedOutbox(): Promise<void> {
  const [attempts, marks, annotations] = await Promise.all([
    store.loadAttempts(), store.loadMarks(), store.loadAllAnnotations(),
  ])
  await Promise.all([
    ...attempts.map((a) => store.enqueue('attempt', a.id)),
    ...marks.map((m) => store.enqueue('mark', m.question_id)),
    ...annotations.map((a) => store.enqueue('annotation', a.question_id)),
  ])
}

/** Signing out leaves local data alone; only the queue and cursor go. */
export async function reset(): Promise<void> {
  const keys = await store.loadOutbox()
  await store.clearOutbox(keys)
  await store.setMeta(CURSOR_KEY, 0)
  emit('off')
}

let started = false

/** Wired once from App. Idempotent. */
export function start(): void {
  if (started || !auth.configured) return
  started = true

  if (!auth.signedIn()) { emit('off'); return }
  void syncNow()

  document.addEventListener('visibilitychange', () => {
    if (!auth.signedIn()) return
    // Flush on the way out so nothing is stranded when a laptop closes, and
    // pull on the way back in to pick up the other machine.
    void syncNow()
  })
}

export async function refreshStatus(): Promise<void> {
  if (!auth.signedIn()) { emit('off'); return }
  const remaining = await store.loadOutbox()
  emit(remaining.length ? 'pending' : 'synced')
}
