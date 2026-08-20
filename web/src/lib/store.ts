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

const DB_NAME = 'satbluebank'
const DB_VERSION = 1

export const STORE_INDEX = 'index'        // Stub, keyed by _id
export const STORE_QUESTIONS = 'questions' // StoredQuestion, keyed by id
export const STORE_ATTEMPTS = 'attempts'   // Attempt, keyed by uuid
export const STORE_MARKS = 'marks'         // { question_id, flagged }
export const STORE_ANNOTATIONS = 'annotations' // { question_id, items }
export const STORE_META = 'meta'           // arbitrary key/value

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
    request.onupgradeneeded = () => {
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

export const loadMarks = () => getAll<{ question_id: string; flagged: number }>(STORE_MARKS)
export const saveMark = (question_id: string, flagged: boolean) =>
  put(STORE_MARKS, { question_id, flagged: flagged ? 1 : 0 })

export const loadAnnotations = (question_id: string) =>
  get<{ question_id: string; items: Annotation[] }>(STORE_ANNOTATIONS, question_id)
export const saveAnnotations = (question_id: string, items: Annotation[]) =>
  put(STORE_ANNOTATIONS, { question_id, items })

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
