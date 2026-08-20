/**
 * Browser client for the three College Board question-bank endpoints.
 *
 * No authentication of any kind is required, and all three send
 * `Access-Control-Allow-Origin: *`, which is the only reason a static site can
 * work at all. Verified first-hand from a real browser origin, not inferred
 * from curl headers.
 *
 * That header is theirs to change. If they ever tighten it this whole backend
 * stops working in a browser while the Python one keeps going, because a
 * server ignores CORS. That is the main reason both backends are kept.
 */
import { dedupeStubs, tagStub, type Stub } from './normalize'
import type { Section } from '../types'

const LIST_URL = 'https://qbank-api.collegeboard.org/msreportingquestionbank-prod'
  + '/questionbank/digital/get-questions'
const DETAIL_URL = 'https://qbank-api.collegeboard.org/msreportingquestionbank-prod'
  + '/questionbank/digital/get-question'
const IBN_URL = (ibn: string) => `https://saic.collegeboard.org/disclosed/${ibn}.json`

const SAT_EVENT_ID = 99
const RW = 1
const MATH = 2
const DOMAINS: Record<number, string> = { [RW]: 'INI,CAS,EOI,SEC', [MATH]: 'H,P,Q,S' }

const RETRIES = 4
const TIMEOUT_MS = 60_000

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any

async function request(url: string, init: RequestInit): Promise<Json> {
  let last: unknown = null
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return await response.json()
    } catch (error) {
      last = error
      // Exponential backoff, same shape as the Python client.
      if (attempt < RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000))
      }
    }
  }
  throw new Error(`${url} failed after ${RETRIES} attempts: ${last}`)
}

function post(url: string, payload: unknown): Promise<Json> {
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/**
 * The whole index in two requests. Measured at 1.66s for all 3,770 entries,
 * which is what makes the on-demand model viable: metadata now, bodies later.
 */
export async function fetchIndex(): Promise<Stub[]> {
  const sections: [number, Section][] = [[RW, 'RW'], [MATH, 'MATH']]
  const pages = await Promise.all(sections.map(async ([test, section]) => {
    const rows: Json[] = await post(LIST_URL, {
      asmtEventId: SAT_EVENT_ID, test, domain: DOMAINS[test],
    })
    return rows.map((row) => tagStub(row, section))
  }))
  return dedupeStubs(pages.flat())
}

/** One question body. The two payload shapes come from two different hosts. */
export async function fetchDetail(stub: Stub): Promise<Json> {
  if (stub._path === 'external_id') {
    return post(DETAIL_URL, { external_id: stub._id })
  }
  // The disclosed endpoint returns a one-element array.
  const payload = await request(IBN_URL(stub._id), { method: 'GET' })
  return Array.isArray(payload) ? payload[0] : payload
}
