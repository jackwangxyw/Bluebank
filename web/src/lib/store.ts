/**
 * IndexedDB persistence for the static build. Replaces the SQLite tables that
 * server.py owns: questions, attempts, annotations, marks.
 *
 * Deliberately a thin hand-rolled wrapper rather than a library. There are five
 * stores and a dozen operations; idb/dexie would be more code to audit than
 * this is to write.
 *
 * NOTE: progress stored here is separate from the localhost SQLite database.
 * Answering on Pages does not show up on localhost and vice versa. That is a
 * deliberate choice, not a bug -- see HANDOFF section 7c.
 */
import type { Annotation, StoredQuestion } from '../types'
import type { Stub } from './normalize'

const DB_NAME = 'bluebank'
/**
 * 2 added the outbox store and `updated_at` on marks and annotations, both
 * needed by cloud sync (lib/sync.ts). Bumping this runs the migration in
 * open() below; existing rows are backfilled, never dropped.
 */
const DB_VERSION = 2

export const STORE_INDEX = 'index'        // Stub, keyed by _id
export const STORE_QUESTIONS = 'questions' // StoredQuestion, keyed by id
export const STORE_ATTEMPTS = 'attempts'   // Attempt, keyed by uuid
export const STORE_MARKS = 'marks'         // MarkRecord, keyed by question_id
export const STORE_ANNOTATIONS = 'annotations' // AnnotationRecord, keyed by question_id
export const STORE_META = 'meta'           // arbitrary key/value
export const STORE_OUTBOX = 'outbox'       // { key }, see the outbox section below

export interface Attempt {
  /**
   * A UUID, not an autoincrementing integer.
   *
   * Autoincrement is per-database, so two devices both mint id 5 and any future
   * merge silently drops one of them. Getting this right costs nothing now and
   * becomes a migration the moment real history accumulates.
   */
  id: string
  question_id: string
  answered_at: number
  response: string | null
  correct: 0 | 1
  seconds: number
}

let handle: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (handle) return handle
  handle = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (event) => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_INDEX)) {
        db.createObjectStore(STORE_INDEX, { keyPath: '_id' })
      }
      if (!db.objectStoreNames.contains(STORE_QUESTIONS)) {
        db.createObjectStore(STORE_QUESTIONS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_ATTEMPTS)) {
        const attempts = db.createObjectStore(STORE_ATTEMPTS, { keyPath: 'id' })
        attempts.createIndex('question_id', 'question_id', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE_MARKS)) {
        db.createObjectStore(STORE_MARKS, { keyPath: 'question_id' })
      }
      if (!db.objectStoreNames.contains(STORE_ANNOTATIONS)) {
        db.createObjectStore(STORE_ANNOTATIONS, { keyPath: 'question_id' })
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META)
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: 'key' })
      }

      // v1 -> v2: marks and annotations predate `updated_at`, which the
      // last-write-wins merge needs. Stamp them with the migration time rather
      // than 0 so the first machine migrated does not arbitrarily lose to the
      // second; for a boolean flag either is defensible, but 0 would make every
      // legacy row lose to every other legacy row at random.
      if (event.oldVersion > 0 && event.oldVersion < 2 && request.transaction) {
        const now = Date.now()
        for (const name of [STORE_MARKS, STORE_ANNOTATIONS]) {
          const store = request.transaction.objectStore(name)
          store.openCursor().onsuccess = (e) => {
            const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result
            if (!cursor) return
            const value = cursor.value as { updated_at?: number }
            if (typeof value.updated_at !== 'number') {
              cursor.update({ ...value, updated_at: now })
            }
            cursor.continue()
          }
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return handle
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  body: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const request = body(tx.objectStore(store))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }))
}

export const get = <T>(store: string, key: IDBValidKey) =>
  run<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>)

export const getAll = <T>(store: string) =>
  run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)

export const put = <T>(store: string, value: T, key?: IDBValidKey) =>
  run(store, 'readwrite', (s) => s.put(value as unknown as never, key))

export const remove = (store: string, key: IDBValidKey) =>
  run(store, 'readwrite', (s) => s.delete(key))

/** One transaction for the whole batch: 3,770 separate ones would crawl. */
export function putMany<T>(store: string, values: T[]): Promise<void> {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    const objectStore = tx.objectStore(store)
    for (const value of values) objectStore.put(value as unknown as never)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  }))
}

export const loadIndex = () => getAll<Stub>(STORE_INDEX)
export const saveIndex = (stubs: Stub[]) => putMany(STORE_INDEX, stubs)

export const loadQuestion = (id: string) => get<StoredQuestion>(STORE_QUESTIONS, id)
export const saveQuestion = (q: StoredQuestion) => put(STORE_QUESTIONS, q)

export const loadAttempts = () => getAll<Attempt>(STORE_ATTEMPTS)
export const saveAttempt = (a: Attempt) => put(STORE_ATTEMPTS, a)

/**
 * `updated_at` on these two is what makes the last-write-wins merge possible.
 * Attempts do not need one: they are a grow-only set merged by uuid, so there
 * is nothing to compare.
 */
export interface MarkRecord { question_id: string; flagged: number; updated_at: number }
export interface AnnotationRecord {
  question_id: string
  items: Annotation[]
  updated_at: number
}

export const loadMarks = () => getAll<MarkRecord>(STORE_MARKS)
export const saveMark = (question_id: string, flagged: boolean) =>
  put(STORE_MARKS, { question_id, flagged: flagged ? 1 : 0, updated_at: Date.now() })

export const loadAllAnnotations = () => getAll<AnnotationRecord>(STORE_ANNOTATIONS)
export const loadAnnotations = (question_id: string) =>
  get<AnnotationRecord>(STORE_ANNOTATIONS, question_id)
export const saveAnnotations = (question_id: string, items: Annotation[]) =>
  put(STORE_ANNOTATIONS, { question_id, items, updated_at: Date.now() })

/** Write a merged row verbatim, keeping the server's timestamp. Sync only. */
export const putMark = (row: MarkRecord) => put(STORE_MARKS, row)
export const putAnnotations = (row: AnnotationRecord) => put(STORE_ANNOTATIONS, row)

// ------------------------------------------------------------------- outbox
//
// What has changed locally and not yet reached the server. Keys look like
// `attempt:<uuid>` / `mark:<question_id>` / `annotation:<question_id>`, so a
// repeated edit to the same thing collapses to one entry instead of queueing
// twice.
//
// It lives in IndexedDB rather than memory on purpose: answer forty questions
// on a plane, close the tab, and they still go up next time. That is what makes
// "did that sync?" a question the user cannot get wrong.

export type OutboxKind = 'attempt' | 'mark' | 'annotation'

export const outboxKey = (kind: OutboxKind, id: string) => `${kind}:${id}`

/**
 * Split on the FIRST colon only. Question ids are College Board uuids
 * (`002fb221-07c6-...`) and ibn codes (`015193-DC`), which contain hyphens but
 * never a colon, so the id is whatever follows the first one. Splitting on
 * every colon would truncate any id that ever gained one.
 */
export function parseOutboxKey(key: string): { kind: OutboxKind; id: string } | null {
  const cut = key.indexOf(':')
  if (cut < 1 || cut === key.length - 1) return null
  const kind = key.slice(0, cut)
  if (kind !== 'attempt' && kind !== 'mark' && kind !== 'annotation') return null
  return { kind, id: key.slice(cut + 1) }
}

export const enqueue = (kind: OutboxKind, id: string) =>
  put(STORE_OUTBOX, { key: outboxKey(kind, id) })

export const loadOutbox = () =>
  getAll<{ key: string }>(STORE_OUTBOX).then((rows) => rows.map((r) => r.key))

/**
 * Clear exactly the keys that were sent, never the whole store: a write that
 * landed while the request was in flight must survive to the next sync.
 */
export function clearOutbox(keys: string[]): Promise<void> {
  if (!keys.length) return Promise.resolve()
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite')
    const store = tx.objectStore(STORE_OUTBOX)
    for (const key of keys) store.delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  }))
}

export const getMeta = <T>(key: string) => get<T>(STORE_META, key)
export const setMeta = <T>(key: string, value: T) => put(STORE_META, value, key)

/**
 * Ask the browser not to evict the bank under storage pressure.
 *
 * Without this a full cache is disposable data and can vanish, costing a
 * re-download. Chrome usually grants it silently for a site with engagement;
 * a refusal is not an error worth surfacing.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
