/**
 * Google sign-in for cloud sync.
 *
 * Two rules shape this file, and both are requirements rather than taste
 * (HANDOFF 7d):
 *
 *   1. Google's script is NOT loaded until the user asks for it. Someone who
 *      never opens the account page makes zero requests to accounts.google.com.
 *      That is why loadGis() is lazy instead of a <script> tag in index.html.
 *
 *   2. No One Tap, ever. `prompt()` is never called and auto_select is off, so
 *      nothing appears unless a button is deliberately clicked.
 *
 * What comes back from Google is an ID token. It is swapped once for our own
 * session token and then discarded: after sign-in the app never talks to Google
 * again, so its one-hour expiry does not matter.
 */

const TOKEN_KEY = 'bluebank.session'
const GIS_SRC = 'https://accounts.google.com/gsi/client'

/**
 * Trailing slashes are stripped. Pasting the Worker URL out of the Cloudflare
 * dashboard gives you one, and `${API}/sync` would then request `//sync`, whose
 * pathname does not match the Worker's route: every sync 404s and the badge
 * sits on amber forever. Both forms are reasonable things to put in the env
 * file, so both have to work.
 */
export const API = (import.meta.env.VITE_SYNC_API as string | undefined)
  ?.replace(/\/+$/, '')
export const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

/** Sync is only offered when both are configured at build time. */
export const configured = Boolean(API && CLIENT_ID)

export const getToken = (): string | null => {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

const setToken = (token: string | null) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* private mode: sync is off, the app is unaffected */ }
}

export const signedIn = () => Boolean(getToken())

interface GisCredentialResponse { credential: string }
interface GisIdApi {
  initialize(config: {
    client_id: string
    callback: (r: GisCredentialResponse) => void
    auto_select: boolean
    cancel_on_tap_outside: boolean
  }): void
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void
  disableAutoSelect(): void
}
declare global {
  interface Window { google?: { accounts: { id: GisIdApi } } }
}

let gis: Promise<GisIdApi> | null = null

/** Injects Google's script on first call, then resolves from cache. */
export function loadGis(): Promise<GisIdApi> {
  if (gis) return gis
  gis = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) { resolve(window.google.accounts.id); return }
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.onload = () => {
      const api = window.google?.accounts?.id
      if (api) resolve(api)
      else reject(new Error('Google sign-in failed to initialise'))
    }
    script.onerror = () => reject(new Error('Could not reach Google sign-in'))
    document.head.appendChild(script)
  })
  // A failed load must not be cached, or a flaky network disables sign-in for
  // the rest of the session with no way back.
  gis.catch(() => { gis = null })
  return gis
}

export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(`${API}${path}`, { ...init, headers })
  if (res.status === 401) {
    // The session died server-side. Drop it so the UI stops claiming sync is on.
    setToken(null)
  }
  return res
}

/**
 * Render Google's button into `parent`. Their branding is required, so this is
 * their button rather than one of ours; everything around it is not.
 */
export async function renderButton(
  parent: HTMLElement,
  onSignedIn: () => void,
  onError: (message: string) => void,
): Promise<void> {
  const api = await loadGis()
  api.initialize({
    client_id: CLIENT_ID as string,
    auto_select: false,            // never sign someone in silently
    cancel_on_tap_outside: true,
    callback: (response) => {
      exchange(response.credential).then(onSignedIn).catch((e: Error) => onError(e.message))
    },
  })
  api.renderButton(parent, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'pill',
    logo_alignment: 'left',
  })
}

async function exchange(credential: string): Promise<void> {
  const res = await fetch(`${API}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  })
  const body = await res.json().catch(() => ({})) as { token?: string; error?: string }
  if (!res.ok || !body.token) throw new Error(body.error || 'Sign-in failed')
  setToken(body.token)
}

/**
 * Ends the session. Local practice history is deliberately untouched: signing
 * out stops syncing, it does not cost you your work.
 */
export async function signOut(): Promise<void> {
  try { await request('/signout', { method: 'POST' }) } catch { /* leaving anyway */ }
  setToken(null)
  try { (await loadGis()).disableAutoSelect() } catch { /* nothing to disable */ }
}

/** Erases everything held server-side for this account. Local data survives. */
export async function deleteRemoteData(): Promise<void> {
  const res = await request('/me', { method: 'DELETE' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error || 'Could not delete your data')
  }
  setToken(null)
}
