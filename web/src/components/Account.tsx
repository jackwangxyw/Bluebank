/**
 * The account badge and its panel: the only sync affordance in the app.
 *
 * It lives in the corner of the Stats page and nowhere else. Because lib/auth.ts
 * loads Google's script lazily, someone who never opens that page never makes a
 * request to Google either.
 *
 * When VITE_SYNC_API is unset (the localhost build) this renders nothing at all.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import * as auth from '../lib/auth'
import * as sync from '../lib/sync'
import { Icon } from './Icon'

const LABEL: Record<sync.SyncStatus, string> = {
  // Says what the feature is, not just that it is off. "Not signed in" told you
  // the state but never that syncing was on offer.
  off: 'Sign in to sync',
  syncing: 'Syncing',
  synced: 'Synced',
  pending: 'Not synced',
}

/**
 * Shown instead of LABEL on a phone, where the nav row has about 70px left
 * after the wordmark and three tabs. Hiding the label entirely was the first
 * attempt and it put the discoverability problem straight back: a bare coloured
 * dot does not tell anyone that signing in is possible.
 */
const SHORT: Record<sync.SyncStatus, string> = {
  off: 'Sync',
  syncing: 'Sync',
  synced: 'Synced',
  pending: 'Sync',
}

/** Subscribes to the sync module so the dot tracks it without prop drilling. */
function useSyncStatus(): sync.SyncStatus {
  const [status, setStatus] = useState<sync.SyncStatus>(sync.getStatus())
  useEffect(() => sync.subscribe(() => setStatus(sync.getStatus())), [])
  return status
}

export function AccountBadge() {
  const status = useSyncStatus()
  const [open, setOpen] = useState(false)
  const [signedIn, setSignedIn] = useState(auth.signedIn())
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!auth.configured) return null

  return (
    <div className="acct" ref={wrap}>
      <button className={`acct-badge ${status}`} onClick={() => setOpen((v) => !v)}
              aria-expanded={open} title="Sync and account">
        <span className="acct-dot" aria-hidden="true" />
        <span className="acct-label">{LABEL[status]}</span>
        <span className="acct-label-sm" aria-hidden="true">{SHORT[status]}</span>
      </button>
      {/*
        Signed-in and signed-out are separate COMPONENTS, not two branches of
        one. React diffs a component's output by position, so returning both
        shapes from a single component let it reuse the host <div> that Google's
        button had been rendered into: it swapped the className and kept the
        iframe, because an element GIS injected is not in React's tree and React
        never removes it. The result was a stale "Sign in as ..." button, name
        and email included, sitting inside the signed-in panel. Two component
        types force a real unmount and the iframe goes with it.
      */}
      {open && !signedIn ? (
        <SignedOutPanel onSignedIn={() => setSignedIn(true)} />
      ) : null}
      {open && signedIn ? (
        <SignedInPanel onSignedOut={() => setSignedIn(false)}
                       onClose={() => setOpen(false)} />
      ) : null}
    </div>
  )
}

function SignedOutPanel({ onSignedIn }: { onSignedIn: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const slot = useRef<HTMLDivElement>(null)
  const rendered = useRef(false)

  // Google's script is fetched here and only here, on a panel the user opened
  // deliberately. Nothing loads it on app start.
  useEffect(() => {
    if (rendered.current || !slot.current) return
    rendered.current = true
    auth.renderButton(
      slot.current,
      async () => {
        onSignedIn()
        // Everything practised anonymously goes up on the first sync. Safe
        // because attempts are a grow-only set: re-sending is a no-op.
        await sync.seedOutbox()
        await sync.syncNow()
      },
      (message) => { setError(message); rendered.current = false },
    ).catch((e: Error) => { setError(e.message); rendered.current = false })
  }, [onSignedIn])

  return (
    <div className="acct-panel" role="dialog" aria-label="Sync">
      <h3 className="acct-h">Sync across devices</h3>
      <div className="acct-gbtn" ref={slot} />
      {error ? <p className="acct-err">{error}</p> : null}
      <p className="acct-fine">
        Bluebank works fully without an account. Nothing is uploaded unless you
        sign in.
      </p>
    </div>
  )
}

function SignedInPanel(
  { onSignedOut, onClose }: { onSignedOut: () => void; onClose: () => void },
) {
  const status = useSyncStatus()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleSignOut = useCallback(async () => {
    setBusy(true)
    await auth.signOut()
    await sync.reset()
    onSignedOut()
    setBusy(false)
    onClose()
  }, [onSignedOut, onClose])

  const handleDelete = useCallback(async () => {
    setBusy(true)
    try {
      await auth.deleteRemoteData()
      await sync.reset()
      onSignedOut()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [onSignedOut, onClose])

  return (
    <div className="acct-panel" role="dialog" aria-label="Sync">
      <h3 className="acct-h">Sync</h3>
      <p className="acct-status">
        <span className={`acct-dot ${status}`} aria-hidden="true" />
        {LABEL[status]}
        {status === 'pending' ? ', will retry' : null}
      </p>
      {error || sync.getError()
        ? <p className="acct-err">{error || sync.getError()}</p>
        : null}

      <div className="acct-actions">
        <button className="acct-btn" disabled={busy || status === 'syncing'}
                onClick={() => { void sync.syncNow() }}>
          <Icon name="arrow-right" size={14} strokeWidth={2.2} />
          Sync now
        </button>
        <button className="acct-btn" disabled={busy} onClick={() => { void handleSignOut() }}>
          Sign out
        </button>
      </div>
      <p className="acct-fine">Signing out keeps everything on this device.</p>

      <div className="acct-danger">
        {confirmDelete ? (
          <>
            <p className="acct-p">
              Deletes everything stored on the server for your account. Practice
              history on this device is kept.
            </p>
            <div className="acct-actions">
              <button className="acct-btn danger" disabled={busy}
                      onClick={() => { void handleDelete() }}>
                {busy ? 'Deleting…' : 'Yes, delete it'}
              </button>
              <button className="acct-btn" disabled={busy}
                      onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button className="acct-link" onClick={() => setConfirmDelete(true)}>
            Delete my synced data
          </button>
        )}
      </div>
    </div>
  )
}
