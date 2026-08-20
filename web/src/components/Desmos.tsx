import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

// Desmos publish their demo key in the API docs. Swap in your own from
// desmos.com/api if you ever host this somewhere public.
const API_KEY = 'dcb31709b452b1cf9dc26972add0fda6'
const SRC = `https://www.desmos.com/api/v1.11/calculator.js?apiKey=${API_KEY}`

interface Calculator {
  destroy(): void
  resize?(): void
}

declare global {
  interface Window {
    Desmos?: { GraphingCalculator: (el: HTMLElement, opts?: object) => Calculator }
  }
}

let loader: Promise<void> | null = null

/** Loaded on first open only, so the app needs no network until you ask for it. */
function loadDesmos(): Promise<void> {
  if (window.Desmos) return Promise.resolve()
  if (loader) return loader
  loader = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('could not load Desmos (needs a network connection)'))
    document.head.appendChild(script)
  })
  return loader
}

const MIN_W = 360
const MIN_H = 300

interface Rect { x: number; y: number; w: number; h: number }

/**
 * Where the window was when you last closed it. Module-level rather than React
 * state so it survives unmount: reopening the calculator puts it back where you
 * left it, which is what the real app does.
 *
 * Defaults to the LEFT edge. Bluebook opens it there, and on a split-pane
 * reading question the right side is where the question lives.
 */
const remembered: Rect = { x: 20, y: 14, w: 560, h: 520 }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

interface Props {
  onClose: () => void
  onExpandedChange: (expanded: boolean) => void
}

export function Desmos({ onClose, onExpandedChange }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const calc = useRef<Calculator | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rect, setRect] = useState<Rect>({ ...remembered })
  // Expanded snaps to the left half at full height, Bluebook's split-screen mode.
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadDesmos()
      .then(() => {
        if (cancelled || !host.current || !window.Desmos) return
        calc.current = window.Desmos.GraphingCalculator(host.current, {
          expressionsCollapsed: false,
          border: false,
        })
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
      calc.current?.destroy()
      calc.current = null
    }
  }, [])

  // Desmos sizes its canvas to the container, so it has to be told when the
  // container changed. Without this the graph stays letterboxed after a resize.
  useEffect(() => { calc.current?.resize?.() }, [rect.w, rect.h, expanded])

  useEffect(() => {
    if (!expanded) Object.assign(remembered, rect)
  }, [rect, expanded])

  // Expanding is a real split, not an overlay: the shell reflows the question
  // into the other half. Reset on unmount or the pane stays indented.
  useEffect(() => { onExpandedChange(expanded) }, [expanded, onExpandedChange])
  useEffect(() => () => onExpandedChange(false), [onExpandedChange])

  const bounds = useCallback(() => {
    const parent = panel.current?.parentElement
    return parent
      ? { w: parent.clientWidth, h: parent.clientHeight }
      : { w: window.innerWidth, h: window.innerHeight }
  }, [])

  /** Shared pointer-drag plumbing for both the title bar and the resize grip. */
  function drag(
    event: React.PointerEvent,
    onMove: (dx: number, dy: number, start: Rect, limit: { w: number; h: number }) => Rect,
  ) {
    if (expanded) return
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const start = { ...rect }
    const limit = bounds()
    document.body.classList.add('dragging-panel')

    function move(e: PointerEvent) {
      setRect(onMove(e.clientX - startX, e.clientY - startY, start, limit))
    }
    function up() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('dragging-panel')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onTitleDown = (e: React.PointerEvent) => drag(e, (dx, dy, s, limit) => ({
    ...s,
    x: clamp(s.x + dx, 0, Math.max(0, limit.w - s.w)),
    y: clamp(s.y + dy, 0, Math.max(0, limit.h - s.h)),
  }))

  const onGripDown = (e: React.PointerEvent) => drag(e, (dx, dy, s, limit) => ({
    ...s,
    w: clamp(s.w + dx, MIN_W, limit.w - s.x),
    h: clamp(s.h + dy, MIN_H, limit.h - s.y),
  }))

  const style = expanded
    ? undefined
    : { left: rect.x, top: rect.y, width: rect.w, height: rect.h }

  return (
    <div ref={panel}
         className={expanded ? 'desmos-panel is-expanded' : 'desmos-panel'}
         style={style}
         role="dialog"
         aria-label="Graphing calculator">
      <div className="desmos-head" onPointerDown={onTitleDown}>
        <Icon name="grip-h" size={16} className="desmos-grab" />
        <span className="desmos-title">Graphing Calculator</span>
        <button className="desmos-btn"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setExpanded((v) => !v)}
                title={expanded ? 'Restore to a floating window' : 'Expand to a split screen'}
                aria-pressed={expanded}>
          <Icon name={expanded ? 'shrink' : 'expand'} size={16} strokeWidth={2} />
        </button>
        <button className="desmos-btn"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={onClose}
                title="Close calculator">
          <Icon name="close" size={16} strokeWidth={2} />
        </button>
      </div>

      {error ? <p className="desmos-error">{error}</p> : <div ref={host} className="desmos-host" />}

      {expanded ? null : (
        <span className="desmos-resize" onPointerDown={onGripDown}
              title="Drag to resize" aria-hidden="true" />
      )}
    </div>
  )
}
