/**
 * Bluebank cloud sync.
 *
 * PLAIN JAVASCRIPT, ONE FILE, ON PURPOSE. Setup is done through the Cloudflare
 * dashboard rather than wrangler, and the dashboard's Edit Code editor runs
 * JavaScript: TypeScript syntax (interfaces, type annotations, generics) is a
 * syntax error there. So this file has to paste in and run as-is, with no
 * imports, no bundler, no npm and no build step. Do not convert it to .ts
 * without also changing the deploy method in HANDOFF 7d.
 *
 * Editor support comes from worker/jsconfig.json plus worker/types.d.ts, which
 * declare the D1 surface locally. That is why no @cloudflare/workers-types
 * dependency is needed.
 *
 * Bindings expected (Worker -> Settings -> Bindings / Variables and Secrets):
 *   DB                D1 database binding, named exactly `DB`
 *   GOOGLE_CLIENT_ID  secret, the OAuth client id ending .apps.googleusercontent.com
 *   ALLOWED_SUBS      secret, OPTIONAL. Comma-separated Google subs. Unset means
 *                     anyone may sign in; setting it makes the site single-user
 *                     again, which is the kill switch.
 *
 * Data policy, enforced here and not just documented: the only identifier
 * stored is the Google `sub`. The email in the verified token is read to check
 * nothing and is never written, never logged, never returned.
 *
 * ---------------------------------------------------------------------------
 * On schema.sql, which is deliberately comment-free and one statement per line.
 *
 * The D1 dashboard console splits pasted input on `;` with no understanding of
 * SQL, then sends each fragment as its own query. Two ways that bites:
 *
 *   - A `;` inside a `--` comment cuts a CREATE TABLE in half. The console
 *     reports "incomplete input" even though the file is valid SQLite.
 *   - A fragment with no SQL left in it (a comment-only block, or the text
 *     after the final `;`) is sent as an empty query, and D1 rejects the whole
 *     request with "requests without any query are not supported".
 *
 * So schema.sql carries no comments at all and the notes live here instead.
 * The design behind it:
 *
 *   users        No email column, on purpose. The `sub` is the only identifier
 *                stored anywhere in this system.
 *   sessions     Opaque tokens, so revocation is a DELETE and there is no JWT
 *                signing code to get wrong.
 *   seq          A per-user counter assigned by the server, and the sync
 *                cursor. Client clocks are never compared, so skew between two
 *                machines cannot reorder anything. Gaps in seq are harmless:
 *                everything compares with `>`.
 *   attempts     PRIMARY KEY (sub, id) is what makes the merge a union.
 *   marks,       PRIMARY KEY (sub, question_id), last-write-wins on updated_at,
 *   annotations  guarded server-side in handleSync below.
 * ---------------------------------------------------------------------------
 */

/**
 * Exact origins allowed to call this. Scheme + host + port, never a path.
 * Add the custom domain here when the frontend moves off GitHub Pages; that
 * plus the same string in Google's Authorized JavaScript origins is the whole
 * migration.
 */
const ALLOWED_ORIGINS = [
  'https://satbluebank.com',
  'https://www.satbluebank.com',
  'https://jackwangxyw.github.io',
  'http://localhost:5173',
  'http://localhost:8000',
]

const SESSION_DAYS = 90

/** Ceiling per request, so one call cannot fill the database. */
const MAX_ITEMS_PER_REQUEST = 2000

/**
 * Ceilings per account, so one signed-in user cannot fill it either. Checked in
 * handleSync against the row count already stored.
 *
 * These are not tuning knobs, they are abuse stops, and every one of them is
 * far out of reach of a real user. marks, annotations and mistakes are keyed
 * PRIMARY KEY (sub, question_id), so a person cannot exceed one row per
 * question in the bank, which is under 4,000: the 20,000 ceiling is five times
 * a full sweep of every question that exists. Sets are keyed on a uuid and so
 * are unbounded in principle, but 5,000 of them is years of daily practice.
 *
 * `question_id` is never checked against the real bank, which is what makes
 * these necessary: without them one account can invent question ids and write
 * rows until D1 is full.
 */
const CAPS = {
  attempts: 100000,
  marks: 20000,
  annotations: 20000,
  mistakes: 20000,
  sets: 5000,
}

// ---------------------------------------------------------------- http helpers

/** @param {string | null} origin */
function corsHeaders(origin) {
  // Echo the matched origin rather than '*': required the moment this moves to
  // cookies, and harmless now.
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ''
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

/** @param {unknown} body @param {number} status @param {string | null} origin */
function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}

/** @param {string} message @param {number} status @param {string | null} origin */
function fail(message, status, origin) {
  return json({ error: message }, status, origin)
}

// ---------------------------------------------------------------------- auth

/** @returns {string} 32 random bytes as hex. */
function newToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * What actually goes in the `sessions` table.
 *
 * The bearer token is handed to the client once and never stored. Only its
 * SHA-256 is kept, so a dump of D1 yields nothing that can be replayed. There
 * is no plaintext fallback on lookup: sessions issued before this change stop
 * matching, so everyone signed in at deploy time is signed out once and signs
 * in again. That costs nobody any data, because every row in every table is
 * keyed on `sub` and the client's IndexedDB is never touched by a 401.
 *
 * SHA-256 hex is 64 characters, which is exactly the width newToken() already
 * produced, so `sessions.token` needs no schema change.
 *
 * @param {string} token
 * @returns {Promise<string>}
 */
async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Verify a Google ID token and return its subject, or null.
 *
 * Done once per sign-in, not per request, which is why hitting Google's
 * tokeninfo endpoint is fine here and JWKS + WebCrypto would be over-built.
 *
 * The `aud` check is the one that must never be removed. Without it an ID token
 * minted for ANY other Google app authenticates to this one.
 *
 * @param {string} credential
 * @param {string} clientId
 * @returns {Promise<string | null>}
 */
async function verifyGoogleToken(credential, clientId) {
  const url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential)
  const res = await fetch(url)
  if (!res.ok) return null

  const info = await res.json()
  if (info.aud !== clientId) return null
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') return null
  if (!info.sub) return null
  if (info.exp && Number(info.exp) * 1000 < Date.now()) return null

  // info.email exists here. It is deliberately not read, not stored, not logged.
  return info.sub
}

/**
 * @param {Request} request
 * @param {Env} env
 * @returns {Promise<string | null>}
 */
async function subForRequest(request, env) {
  const header = request.headers.get('Authorization') || ''
  if (!header.startsWith('Bearer ')) return null
  const token = header.slice(7)
  if (!token) return null

  const hashed = await hashToken(token)
  const row = await env.DB.prepare(
    'SELECT sub, expires_at FROM sessions WHERE token = ?').bind(hashed).first()
  if (!row) return null
  if (row.expires_at * 1000 < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(hashed).run()
    return null
  }
  return row.sub
}

// ---------------------------------------------------------------- validation

/** @param {unknown} v @returns {boolean} */
const isStr = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200
/** @param {unknown} v @returns {boolean} */
const isInt = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Drop malformed rows rather than writing junk, and rather than 400-ing the
 * whole request: one bad row must not wedge a client's outbox forever.
 * @param {unknown} raw
 */
function cleanAttempts(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const r of raw.slice(0, MAX_ITEMS_PER_REQUEST)) {
    if (!r || !isStr(r.id) || !isStr(r.question_id) || !isInt(r.answered_at)) continue
    if (!isInt(r.correct)) continue
    out.push({
      id: r.id,
      question_id: r.question_id,
      answered_at: Math.trunc(r.answered_at),
      response: typeof r.response === 'string' ? r.response.slice(0, 200) : null,
      correct: r.correct ? 1 : 0,
      seconds: isInt(r.seconds) ? Math.trunc(r.seconds) : null,
    })
  }
  return out
}

/** @param {unknown} raw */
function cleanMarks(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const r of raw.slice(0, MAX_ITEMS_PER_REQUEST)) {
    if (!r || !isStr(r.question_id) || !isInt(r.updated_at)) continue
    out.push({
      question_id: r.question_id,
      flagged: r.flagged ? 1 : 0,
      updated_at: Math.trunc(r.updated_at),
    })
  }
  return out
}

/** @param {unknown} raw */
function cleanMistakes(raw) {
  if (!Array.isArray(raw)) return []
  const allowed = ['process', 'silly', 'knowledge', 'other']
  const out = []
  for (const r of raw.slice(0, MAX_ITEMS_PER_REQUEST)) {
    if (!r || !isStr(r.question_id) || !isInt(r.updated_at)) continue
    // Drop unknown tags rather than storing them. A stale client cannot invent
    // a category the review page has no label for.
    const tags = Array.isArray(r.tags) ? r.tags.filter((t) => allowed.includes(t)) : []
    out.push({
      question_id: r.question_id,
      tags,
      note: typeof r.note === 'string' ? r.note.slice(0, 4000) : null,
      updated_at: Math.trunc(r.updated_at),
    })
  }
  return out
}

/**
 * A practice set. Mutable until it is finished, so it carries updated_at and
 * merges last-write-wins.
 * @param {unknown} raw
 */
function cleanSets(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const r of raw.slice(0, MAX_ITEMS_PER_REQUEST)) {
    if (!r || !isStr(r.id) || !isInt(r.created_at) || !isInt(r.updated_at)) continue
    if (!Array.isArray(r.items)) continue
    // A set is at most a few hundred questions; anything past this is not one.
    if (r.items.length > 500) continue
    const items = []
    for (const i of r.items) {
      if (!i || !isStr(i.question_id)) continue
      items.push({
        question_id: i.question_id,
        response: typeof i.response === 'string' ? i.response.slice(0, 200) : null,
        correct: i.correct ? 1 : 0,
        seconds: isInt(i.seconds) ? Math.trunc(i.seconds) : 0,
      })
    }
    const filters = r.filters && typeof r.filters === 'object' ? r.filters : {}
    if (JSON.stringify(filters).length > 4000) continue
    out.push({
      id: r.id,
      created_at: Math.trunc(r.created_at),
      // Null is meaningful here: it is what "still active" looks like.
      finished_at: isInt(r.finished_at) ? Math.trunc(r.finished_at) : null,
      updated_at: Math.trunc(r.updated_at),
      seconds: isInt(r.seconds) ? Math.trunc(r.seconds) : 0,
      filters,
      items,
    })
  }
  return out
}

/** @param {unknown} raw */
function cleanAnnotations(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const r of raw.slice(0, MAX_ITEMS_PER_REQUEST)) {
    if (!r || !isStr(r.question_id) || !isInt(r.updated_at)) continue
    if (!Array.isArray(r.items)) continue
    if (JSON.stringify(r.items).length > 100000) continue
    out.push({
      question_id: r.question_id,
      items: r.items,
      updated_at: Math.trunc(r.updated_at),
    })
  }
  return out
}

// ---------------------------------------------------------------------- routes

/**
 * @param {Request} request
 * @param {Env} env
 * @param {string | null} origin
 * @returns {Promise<Response>}
 */
async function handleAuth(request, env, origin) {
  const body = await request.json().catch(() => null)
  if (!body || !body.credential) return fail('missing credential', 400, origin)

  if (!env.GOOGLE_CLIENT_ID) {
    return fail('GOOGLE_CLIENT_ID is not set on the Worker. Check GET /health.', 500, origin)
  }

  const sub = await verifyGoogleToken(body.credential, env.GOOGLE_CLIENT_ID)
  if (!sub) return fail('invalid token', 401, origin)

  const allowed = (env.ALLOWED_SUBS || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (allowed.length && !allowed.includes(sub)) {
    return fail('this account is not allowed to sign in', 403, origin)
  }
  if (!allowed.length) {
    // The only way to learn your own sub for the kill switch. Read it from
    // Worker -> Logs -> Live, then set ALLOWED_SUBS. Prints no email.
    console.log('ALLOWED_SUBS unset, allowing sub=' + sub)
  }

  const now = Math.floor(Date.now() / 1000)
  const token = newToken()
  // Only the hash is stored. `token` goes back to the caller and is then gone
  // from this side for good.
  const hashed = await hashToken(token)
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO users (sub, created_at) VALUES (?, ?)').bind(sub, now),
    env.DB.prepare(
      'INSERT INTO sessions (token, sub, created_at, expires_at) VALUES (?,?,?,?)',
    ).bind(hashed, sub, now, now + SESSION_DAYS * 86400),
    // Opportunistic cleanup; sessions are the only table that accumulates junk.
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
  ])

  return json({ token }, 200, origin)
}

/**
 * @param {Request} request
 * @param {Env} env
 * @param {string | null} origin
 * @returns {Promise<Response>}
 */
async function handleSync(request, env, origin) {
  const sub = await subForRequest(request, env)
  if (!sub) return fail('not signed in', 401, origin)

  const body = await request.json().catch(() => null)
  if (!body) return fail('bad body', 400, origin)

  const since = isInt(body.since) ? Math.trunc(body.since) : 0
  const attempts = cleanAttempts(body.attempts)
  const marks = cleanMarks(body.marks)
  const annotations = cleanAnnotations(body.annotations)
  const mistakes = cleanMistakes(body.mistakes)
  const sets = cleanSets(body.sets)

  // Refuse only when what is ALREADY stored is at the ceiling, rather than when
  // stored + incoming would cross it. Two reasons, both about not breaking real
  // users:
  //
  //   - Most incoming rows are not new. seedOutbox() re-pushes a device's whole
  //     history on sign-in, and the LWW tables re-push a row every time it is
  //     edited, so stored + incoming wildly overcounts. The old attempts check
  //     did this and could wedge an account near the ceiling permanently: every
  //     retry sent the same rows and got the same 413 forever.
  //   - The cost of the looser rule is that one request can overshoot by at
  //     most MAX_ITEMS_PER_REQUEST before the next one is refused. That is a
  //     bounded overshoot on an abuse stop, which does not matter.
  //
  // The whole request is refused rather than the offending table being dropped,
  // because the client clears its outbox on any 2xx: silently discarding one
  // table's writes would let the client believe they had synced.
  const checks = []
  if (attempts.length) checks.push('attempts')
  if (marks.length) checks.push('marks')
  if (annotations.length) checks.push('annotations')
  if (mistakes.length) checks.push('mistakes')
  if (sets.length) checks.push('sets')

  if (checks.length) {
    // Table names come from the literal list above, never from the request.
    const counts = await env.DB.batch(checks.map((table) => env.DB.prepare(
      'SELECT COUNT(*) AS n FROM ' + table + ' WHERE sub = ?').bind(sub)))
    for (let i = 0; i < checks.length; i++) {
      const rows = (counts[i] && counts[i].results) || []
      const n = (rows[0] && rows[0].n) || 0
      if (n >= CAPS[checks[i]]) {
        return fail('storage limit reached for ' + checks[i] + ' on this account', 413, origin)
      }
    }
  }

  // Bump the cursor first and read it back. D1 has no interactive transactions,
  // so this cannot be folded into the batch below. A crash in between burns a
  // seq number, which nothing cares about.
  const bumped = await env.DB.prepare(
    'INSERT INTO cursors (sub, seq) VALUES (?, 1)'
    + ' ON CONFLICT(sub) DO UPDATE SET seq = seq + 1 RETURNING seq',
  ).bind(sub).first()
  const seq = (bumped && bumped.seq) || 1

  const writes = []

  for (const a of attempts) {
    // Union by (sub, id). An attempt is immutable once written, so IGNORE is
    // the whole merge rule: replaying the same attempt is a no-op.
    writes.push(env.DB.prepare(
      'INSERT OR IGNORE INTO attempts'
      + ' (sub, id, question_id, answered_at, response, correct, seconds, seq)'
      + ' VALUES (?,?,?,?,?,?,?,?)',
    ).bind(sub, a.id, a.question_id, a.answered_at, a.response, a.correct, a.seconds, seq))
  }

  // Last-write-wins, guarded SERVER-side so a client with a wrong clock cannot
  // stomp newer data. The WHERE on the DO UPDATE is what enforces it.
  for (const m of marks) {
    writes.push(env.DB.prepare(
      'INSERT INTO marks (sub, question_id, flagged, updated_at, seq) VALUES (?,?,?,?,?)'
      + ' ON CONFLICT(sub, question_id) DO UPDATE SET'
      + '   flagged = excluded.flagged, updated_at = excluded.updated_at, seq = excluded.seq'
      + ' WHERE excluded.updated_at > marks.updated_at',
    ).bind(sub, m.question_id, m.flagged, m.updated_at, seq))
  }

  for (const n of annotations) {
    writes.push(env.DB.prepare(
      'INSERT INTO annotations (sub, question_id, items_json, updated_at, seq)'
      + ' VALUES (?,?,?,?,?)'
      + ' ON CONFLICT(sub, question_id) DO UPDATE SET'
      + '   items_json = excluded.items_json, updated_at = excluded.updated_at,'
      + '   seq = excluded.seq'
      + ' WHERE excluded.updated_at > annotations.updated_at',
    ).bind(sub, n.question_id, JSON.stringify(n.items), n.updated_at, seq))
  }

  for (const m of mistakes) {
    writes.push(env.DB.prepare(
      'INSERT INTO mistakes (sub, question_id, tags_json, note, updated_at, seq)'
      + ' VALUES (?,?,?,?,?,?)'
      + ' ON CONFLICT(sub, question_id) DO UPDATE SET'
      + '   tags_json = excluded.tags_json, note = excluded.note,'
      + '   updated_at = excluded.updated_at, seq = excluded.seq'
      + ' WHERE excluded.updated_at > mistakes.updated_at',
    ).bind(sub, m.question_id, JSON.stringify(m.tags), m.note, m.updated_at, seq))
  }

  // Last-write-wins, guarded server-side like marks and annotations. A set is
  // worked through over time, so two devices can both hold a version of it.
  for (const s of sets) {
    writes.push(env.DB.prepare(
      'INSERT INTO sets'
      + ' (sub, id, created_at, finished_at, updated_at, seconds, filters_json,'
      + '  items_json, seq)'
      + ' VALUES (?,?,?,?,?,?,?,?,?)'
      + ' ON CONFLICT(sub, id) DO UPDATE SET'
      + '   finished_at = excluded.finished_at, updated_at = excluded.updated_at,'
      + '   seconds = excluded.seconds, filters_json = excluded.filters_json,'
      + '   items_json = excluded.items_json, seq = excluded.seq'
      + ' WHERE excluded.updated_at > sets.updated_at',
    ).bind(sub, s.id, s.created_at, s.finished_at, s.updated_at, s.seconds,
           JSON.stringify(s.filters), JSON.stringify(s.items), seq))
  }

  if (writes.length) await env.DB.batch(writes)

  // Deliberately returns the caller's own writes back to it. For the two LWW
  // stores that is how the client learns what the server actually decided, so a
  // rejected update self-corrects on the same round trip.
  const [outAttempts, outMarks, outAnnotations, outMistakes, outSets] = await env.DB.batch([
    env.DB.prepare(
      'SELECT id, question_id, answered_at, response, correct, seconds'
      + ' FROM attempts WHERE sub = ? AND seq > ?').bind(sub, since),
    env.DB.prepare(
      'SELECT question_id, flagged, updated_at FROM marks WHERE sub = ? AND seq > ?',
    ).bind(sub, since),
    env.DB.prepare(
      'SELECT question_id, items_json, updated_at FROM annotations WHERE sub = ? AND seq > ?',
    ).bind(sub, since),
    env.DB.prepare(
      'SELECT question_id, tags_json, note, updated_at FROM mistakes WHERE sub = ? AND seq > ?',
    ).bind(sub, since),
    env.DB.prepare(
      'SELECT id, created_at, finished_at, updated_at, seconds, filters_json,'
      + ' items_json FROM sets WHERE sub = ? AND seq > ?',
    ).bind(sub, since),
  ])

  return json({
    cursor: seq,
    attempts: outAttempts.results || [],
    marks: outMarks.results || [],
    annotations: (outAnnotations.results || []).map((row) => {
      let items = []
      // A row we wrote ourselves, so this should never throw. If the column is
      // ever corrupted, drop that question's highlights rather than 500 the sync.
      try { items = JSON.parse(row.items_json) } catch { items = [] }
      return { question_id: row.question_id, items, updated_at: row.updated_at }
    }),
    mistakes: (outMistakes.results || []).map((row) => {
      let tags = []
      try { tags = JSON.parse(row.tags_json) } catch { tags = [] }
      return {
        question_id: row.question_id, tags, note: row.note, updated_at: row.updated_at,
      }
    }),
    sets: (outSets.results || []).map((row) => {
      let filters = {}
      let items = []
      try { filters = JSON.parse(row.filters_json) } catch { filters = {} }
      try { items = JSON.parse(row.items_json) } catch { items = [] }
      return {
        id: row.id,
        created_at: row.created_at,
        finished_at: row.finished_at,
        updated_at: row.updated_at,
        seconds: row.seconds,
        filters,
        items,
      }
    }),
  }, 200, origin)
}

/**
 * @param {Request} request
 * @param {Env} env
 * @param {string | null} origin
 * @returns {Promise<Response>}
 */
async function handleSignOut(request, env, origin) {
  const header = request.headers.get('Authorization') || ''
  if (header.startsWith('Bearer ')) {
    const hashed = await hashToken(header.slice(7))
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(hashed).run()
  }
  // Always 200: signing out of an already-dead session is not an error, and the
  // client clears its token either way.
  return json({ ok: true }, 200, origin)
}

/**
 * @param {Request} request
 * @param {Env} env
 * @param {string | null} origin
 * @returns {Promise<Response>}
 */
async function handleDelete(request, env, origin) {
  const sub = await subForRequest(request, env)
  if (!sub) return fail('not signed in', 401, origin)

  // Everything, across every table. This is the GDPR/CCPA erasure path and it
  // must leave nothing behind. It does NOT touch the caller's IndexedDB, so
  // deleting cloud data never costs someone their own practice history.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM attempts    WHERE sub = ?').bind(sub),
    env.DB.prepare('DELETE FROM marks       WHERE sub = ?').bind(sub),
    env.DB.prepare('DELETE FROM annotations WHERE sub = ?').bind(sub),
    env.DB.prepare('DELETE FROM mistakes    WHERE sub = ?').bind(sub),
    env.DB.prepare('DELETE FROM sets        WHERE sub = ?').bind(sub),
    env.DB.prepare('DELETE FROM cursors     WHERE sub = ?').bind(sub),
    env.DB.prepare('DELETE FROM sessions    WHERE sub = ?').bind(sub),
    env.DB.prepare('DELETE FROM users       WHERE sub = ?').bind(sub),
  ])
  return json({ ok: true }, 200, origin)
}

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const origin = request.headers.get('Origin')
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return fail('origin not allowed', 403, origin)
    }

    try {
      if (url.pathname === '/health' && request.method === 'GET') {
        // Booleans and the client id only. The client id is public by
        // definition (it ships in the frontend bundle), so echoing it is how
        // you confirm the Worker and the site agree on it. ALLOWED_SUBS is
        // reported as a count, never a value: a sub identifies a person.
        const subs = (env.ALLOWED_SUBS || '').split(',').map((s) => s.trim()).filter(Boolean)
        return json({
          ok: true,
          d1Bound: Boolean(env.DB),
          googleClientId: env.GOOGLE_CLIENT_ID || null,
          allowedSubsCount: subs.length,
          allowedOrigins: ALLOWED_ORIGINS,
        }, 200, origin)
      }
      if (url.pathname === '/auth/google' && request.method === 'POST') {
        return await handleAuth(request, env, origin)
      }
      if (url.pathname === '/sync' && request.method === 'POST') {
        return await handleSync(request, env, origin)
      }
      if (url.pathname === '/signout' && request.method === 'POST') {
        return await handleSignOut(request, env, origin)
      }
      if (url.pathname === '/me' && request.method === 'DELETE') {
        return await handleDelete(request, env, origin)
      }
      return fail('not found', 404, origin)
    } catch (e) {
      // Log the message only. Never log a request body: annotations are the
      // user's own free text.
      console.error('unhandled', e && e.message)
      return fail('server error', 500, origin)
    }
  },
}
