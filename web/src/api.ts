/**
 * Picks the data backend. Everything in the app goes through this module, and
 * nothing else touches the network or storage.
 *
 *   apiHttp   localhost. The Python server owns SQLite, does the grading, and
 *             withholds the answer key until you answer. Pulls the whole bank
 *             up front, which is fine because it is local.
 *   apiLocal  GitHub Pages. No server: fetches College Board directly, caches
 *             in IndexedDB, grades in the browser. Loads the index up front
 *             (~1.7s) and question bodies on demand.
 *
 * Chosen at BUILD time via VITE_BACKEND, not by probing at runtime: a runtime
 * probe costs a failed request and a race on every cold load.
 *
 *   npm run build         -> http   (default)
 *   npm run build:pages   -> local
 *
 * `?backend=local` or `?backend=http` overrides it for one page load, so the
 * static path can be exercised against a dev server without a separate build.
 *
 * The two backends do NOT share progress. Answering on Pages does not appear on
 * localhost. That is deliberate.
 */
import * as http from './apiHttp'
import * as local from './apiLocal'

export type BackendName = 'http' | 'local'

function choose(): BackendName {
  const override = new URLSearchParams(window.location.search).get('backend')
  if (override === 'local' || override === 'http') return override
  return import.meta.env.VITE_BACKEND === 'local' ? 'local' : 'http'
}

export const backend: BackendName = choose()

const impl = backend === 'local' ? local : http

export const taxonomy = impl.taxonomy
export const questionSet = impl.questionSet
export const question = impl.question
export const answer = impl.answer
export const flag = impl.flag
export const saveAnnotations = impl.saveAnnotations
export const explain = impl.explain
export const attemptsFor = impl.attemptsFor
export const loggedIds = impl.loggedIds
export const saveMistake = impl.saveMistake
export const reviewed = impl.reviewed
export const stats = impl.stats

// Practice sets: a frozen, randomly drawn list of questions you work through
// and score. Both backends store them the same shape.
export const listSets = impl.listSets
export const getSet = impl.getSet
export const saveSet = impl.saveSet
export const deleteSet = impl.deleteSet

/**
 * Re-read the index from College Board. Static backend only: on localhost the
 * refresh is `python -m bluebank build`.
 */
export const refreshIndex = backend === 'local' ? local.refreshIndex : null
