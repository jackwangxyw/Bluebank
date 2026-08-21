/**
 * The slice of the Cloudflare Workers D1 API that src/index.js actually uses,
 * declared locally.
 *
 * Why not @cloudflare/workers-types: the Worker is deployed by pasting one file
 * into the dashboard, so there is no npm install, no package.json and no build
 * step in this directory. Adding a dependency purely so an editor stops
 * underlining things would be the tail wagging the dog. The runtime globals
 * (Request, Response, fetch, crypto, console, URL) come from the WebWorker lib
 * in jsconfig.json instead.
 *
 * Keep this in step with the calls in src/index.js. It is intentionally NOT the
 * full D1 surface.
 */

/**
 * Row types default to `any`, not `unknown`.
 *
 * A .js file cannot pass a type argument to `first()`, so an `unknown` default
 * makes every column access an error and the only cure is a JSDoc cast at each
 * call site. That trades four real errors for a dozen lines of ceremony in a
 * file whose whole point is pasting into a dashboard. The SQL right above each
 * call already says what the columns are.
 */
interface D1Result<T = any> {
  results?: T[]
  success: boolean
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = any>(): Promise<T | null>
  run<T = any>(): Promise<D1Result<T>>
  all<T = any>(): Promise<D1Result<T>>
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch<T = any>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
}

/** The bindings configured in Worker -> Settings. */
interface Env {
  /** D1 binding. The variable name must be exactly `DB`. */
  DB: D1Database
  /** OAuth client id, ending .apps.googleusercontent.com. */
  GOOGLE_CLIENT_ID: string
  /** Optional kill switch. Unset means anyone may sign in. */
  ALLOWED_SUBS?: string
}
