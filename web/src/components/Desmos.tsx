import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

// Our own key from desmos.com/api, replacing the demo key Desmos publishes in
// their docs (which logs a "not for production" warning on every load).
//
// A Desmos API key is a public identifier, not a secret: it travels in the
// script URL and is visible in the browser on any site that uses one. It being
// in a public repo is expected, not a leak.
const API_KEY = '8359beecc3e74feda51c82d4934c80a1'
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

/**
 * Configured as a testing calculator rather than the full authoring tool.
 *
 * `restrictedFunctions` is Desmos's own option for this: "Show a restricted
 * menu of available functions", which is what standardized tests run. The rest
 * turn off authoring and import affordances that have no place in a practice
 * question and that Bluebook does not offer either.
 *
 * This is the public Desmos API build with test options set. It is NOT College
 * Board's own bundle, which is theirs and not ours to ship.
 */
const CONFIG = {
  restrictedFunctions: true,   // the standardized-testing function menu
  folders: false,              // no authoring the expression list
  notes: false,
  images: false,
  links: false,
  pasteGraphLink: false,       // no importing a graph from a URL
  pasteTableData: false,       // no pasting in a dataset
  expressionsCollapsed: false,
  border: false,
}

const MIN_W = 360
const MIN_H = 300

interface Rect { x: number; y: number; w: number; h: number }

/**
 * Where the window was when you last closed it. Module-level rather than React
 * state so it survives unmount: reopening the calculator puts it back where you
 * left it, which is what the real app does.
 *
 * Defaults to the LEFT edge, and to a PORTRAIT shape (~420x580, measured off
 * the real app). The aspect matters: Desmos lays itself out responsively, so a
 * narrow container stacks the graph above the expression list, which is what
 * Bluebook shows. A landscape container puts expressions down the left instead
 * and looks nothing like the real thing.
 */
const remembered: Rect = { x: 20, y: 14, w: 420, h: 580 }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

interface Props {
  onClose: () => void
  /** Reports the split fraction, or null when floating, so the shell reflows. */
  onExpandedChange: (split: number | null) => void
}

export function Desmos({ onClose, onExpandedChange }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const calc = useRef<Calculator | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rect, setRect] = useState<Rect>({ ...remembered })
  // Expanded snaps to the left at full height, Bluebook's split-screen mode.
  const [expanded, setExpanded] = useState(false)
  // Where the split sits, as a percentage. Draggable like the passage divider.
  const [splitPct, setSplitPct] = useState(50)

  useEffect(() => {
    let cancelled = false
    loadDesmos()
      .then(() => {
        if (cancelled || !host.current) return
        // onload fired but nothing registered itself. That happens when the
        // request was answered by something other than Desmos: a blocker
        // serving an empty stub, a captive portal, a filtering proxy. Silently
        // returning here left an empty window with no clue what went wrong.
        if (!window.Desmos) {
          throw new Error('Desmos loaded but did not start (blocked by an extension or network filter?)')
        }
        calc.current = window.Desmos.GraphingCalculator(host.current, CONFIG)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
      calc.current?.destroy()
      calc.current = null
    }
  }, [])

  /**
   * Fit the window to the pane before it is ever shown, and again whenever the
   * pane changes size.
   *
   * The remembered 420x580 is a default, not a promise. On a short window it
   * does not fit, and every way out of that is itself blocked: dragging clamps
   * y to Math.max(0, limit.h - s.h), which is 0 once the panel is taller than
   * the pane, so the window pins to the top and will not move at all; and the
   * resize grip lives at its bottom right, which by then is below the fold. A
   * 1366x768 laptop leaves this pane 488px tall against a 580px panel, so the
   * calculator opens stuck, with its lower half cut off. Under display scaling
   * the pane is shorter still and the expression list never appears on screen.
   */
  useLayoutEffect(() => {
    const parent = panel.current?.parentElement
    if (!parent) return
    // Returns the same object when nothing moved, so observing the parent
    // cannot feed itself a render loop.
    const fit = () => setRect((r) => {
      const { clientWidth: w, clientHeight: h } = parent
      if (!w || !h) return r
      // Fit to the room left of the right edge and below the bottom, so the
      // window keeps its offset from the corner rather than snapping flush.
      const nw = clamp(r.w, MIN_W, Math.max(MIN_W, w - r.x))
      const nh = clamp(r.h, MIN_H, Math.max(MIN_H, h - r.y))
      const nx = clamp(r.x, 0, Math.max(0, w - nw))
      const ny = clamp(r.y, 0, Math.max(0, h - nh))
      return nw === r.w && nh === r.h && nx === r.x && ny === r.y
        ? r : { x: nx, y: ny, w: nw, h: nh }
    })
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  // Desmos sizes its canvas to the container, so it has to be told when the
  // container changed. Without this the graph stays letterboxed after a resize.
  useEffect(() => { calc.current?.resize?.() }, [rect.w, rect.h, expanded])

  useEffect(() => {
    if (!expanded) Object.assign(remembered, rect)
  }, [rect, expanded])

  // Expanding is a real split, not an overlay: the shell reflows the question
  // into the other half. Reset on unmount or the pane stays indented.
  useEffect(() => {
    onExpandedChange(expanded ? splitPct : null)
  }, [expanded, splitPct, onExpandedChange])
  useEffect(() => () => onExpandedChange(null), [onExpandedChange])

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

  /** Drag the split edge. Same feel as the passage/question divider. */
  function onSplitDown(event: React.PointerEvent) {
    event.preventDefault()
    const limit = bounds()
    document.body.classList.add('dragging')
    function move(e: PointerEvent) {
      const host = panel.current?.parentElement?.getBoundingClientRect()
      const left = host?.left ?? 0
      setSplitPct(clamp(((e.clientX - left) / limit.w) * 100, 25, 75))
    }
    function up() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('dragging')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const style = expanded
    ? { width: `${splitPct}%` }
    : { left: rect.x, top: rect.y, width: rect.w, height: rect.h }

  return (
    <div ref={panel}
         className={expanded ? 'desmos-panel is-expanded' : 'desmos-panel'}
         style={style}
         role="dialog"
         aria-label="Graphing calculator">
      <div className="desmos-head" onPointerDown={onTitleDown}>
        <span className="desmos-title">Calculator</span>
        <Icon name="dots9" size={23} className="desmos-grab" strokeWidth={3.4} />
        <button className="desmos-btn"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setExpanded((v) => !v)}
                title={expanded ? 'Restore to a floating window' : 'Expand'}
                aria-pressed={expanded}>
          <Icon name={expanded ? 'shrink' : 'expand'} size={19} strokeWidth={1.9} />
        </button>
        <button className="desmos-btn"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={onClose}
                title="Close calculator">
          <Icon name="close" size={21} strokeWidth={1.9} />
        </button>
      </div>

      {error ? <p className="desmos-error">{error}</p> : <div ref={host} className="desmos-host" />}

      {expanded ? (
        <span className="desmos-split-grip" onPointerDown={onSplitDown}
              title="Drag to resize" aria-hidden="true" />
      ) : (
        <span className="desmos-resize" onPointerDown={onGripDown}
              title="Drag to resize" aria-hidden="true" />
      )}
    </div>
  )
}
