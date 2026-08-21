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
  'https://jackwangxyw.github.io',
  'http://localhost:5173',
  'http://localhost:8000',
]

const SESSION_DAYS = 90

/** Ceiling per account, so one signed-in user cannot fill the database. */
const MAX_ATTEMPTS_PER_USER = 100000
/** Ceiling per request, so one call cannot. */
const MAX_ITEMS_PER_REQUEST = 2000

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

  const row = await env.DB.prepare(
    'SELECT sub, expires_at FROM sessions WHERE token = ?').bind(token).first()
  if (!row) return null
  if (row.expires_at * 1000 < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
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
  if (!env.GOOGLE_CLIENT_ID) return fail('server not configured', 500, origin)

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
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO users (sub, created_at) VALUES (?, ?)').bind(sub, now),
    env.DB.prepare(
      'INSERT INTO sessions (token, sub, created_at, expires_at) VALUES (?,?,?,?)',
    ).bind(token, sub, now, now + SESSION_DAYS * 86400),
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

  if (attempts.length) {
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM attempts WHERE sub = ?').bind(sub).first()
    if (((count && count.n) || 0) + attempts.length > MAX_ATTEMPTS_PER_USER) {
      return fail('attempt limit reached for this account', 413, origin)
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

  if (writes.length) await env.DB.batch(writes)

  // Deliberately returns the caller's own writes back to it. For the two LWW
  // stores that is how the client learns what the server actually decided, so a
  // rejected update self-corrects on the same round trip.
  const [outAttempts, outMarks, outAnnotations] = await env.DB.batch([
    env.DB.prepare(
      'SELECT id, question_id, answered_at, response, correct, seconds'
      + ' FROM attempts WHERE sub = ? AND seq > ?').bind(sub, since),
    env.DB.prepare(
      'SELECT question_id, flagged, updated_at FROM marks WHERE sub = ? AND seq > ?',
    ).bind(sub, since),
    env.DB.prepare(
      'SELECT question_id, items_json, updated_at FROM annotations WHERE sub = ? AND seq > ?',
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
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(header.slice(7)).run()
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
