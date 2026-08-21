/**
 * The account badge and its panel: the ONLY sync affordance anywhere in the app.
 *
 * It lives in the corner of the You page and nowhere else. A visitor who never
 * opens that page is never shown a sign-in prompt, and because Google's script
 * is loaded lazily by lib/auth.ts they never make a request to Google either.
 *
 * When VITE_SYNC_API is unset (the localhost build) this renders nothing at all.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import * as auth from '../lib/auth'
import * as sync from '../lib/sync'
import { Icon } from './Icon'

const LABEL: Record<sync.SyncStatus, string> = {
  off: 'Not signed in',
  syncing: 'Syncing',
  synced: 'Synced',
  pending: 'Not synced',
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
      </button>
      {open ? <AccountPanel onClose={() => setOpen(false)} /> : null}
    </div>
  )
}

function AccountPanel({ onClose }: { onClose: () => void }) {
  const status = useSyncStatus()
  const [signedIn, setSignedIn] = useState(auth.signedIn())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const buttonSlot = useRef<HTMLDivElement>(null)
  const rendered = useRef(false)

  // Google's script is fetched here and only here, on a panel the user opened
  // deliberately. Nothing loads it on app start.
  useEffect(() => {
    if (signedIn || rendered.current || !buttonSlot.current) return
    rendered.current = true
    auth.renderButton(
      buttonSlot.current,
      async () => {
        setSignedIn(true)
        setError(null)
        // Everything practised anonymously goes up on the first sync. Safe
        // because attempts are a grow-only set: re-sending is a no-op.
        await sync.seedOutbox()
        await sync.syncNow()
      },
      (message) => { setError(message); rendered.current = false },
    ).catch((e: Error) => { setError(e.message); rendered.current = false })
  }, [signedIn])

  const handleSignOut = useCallback(async () => {
    setBusy(true)
    await auth.signOut()
    await sync.reset()
    setSignedIn(false)
    setBusy(false)
    onClose()
  }, [onClose])

  const handleDelete = useCallback(async () => {
    setBusy(true)
    try {
      await auth.deleteRemoteData()
      await sync.reset()
      setSignedIn(false)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [onClose])

  if (!signedIn) {
    return (
      <div className="acct-panel" role="dialog" aria-label="Sync">
        <h3 className="acct-h">Sync across devices</h3>
        <p className="acct-p">
          Practice on a laptop, pick it up on a desktop. Your answers, highlights
          and flagged questions follow you.
        </p>
        <div className="acct-note">
          <p><strong>We do not store your email, name or picture.</strong> Signing
          in links your progress to an anonymous Google account id and nothing else.</p>
          <p>What is stored: which questions you answered, what you answered, your
          highlights and notes, and which questions you flagged.</p>
          <p>You can delete all of it at any time, from this panel.</p>
        </div>
        <div className="acct-gbtn" ref={buttonSlot} />
        {error ? <p className="acct-err">{error}</p> : null}
        <p className="acct-fine">
          Bluebank works fully without an account. Nothing is uploaded unless you
          sign in.
        </p>
      </div>
    )
  }

  return (
    <div className="acct-panel" role="dialog" aria-label="Sync">
      <h3 className="acct-h">Sync</h3>
      <p className="acct-status">
        <span className={`acct-dot ${status}`} aria-hidden="true" />
        {LABEL[status]}
        {status === 'pending' ? ' — will retry' : null}
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
