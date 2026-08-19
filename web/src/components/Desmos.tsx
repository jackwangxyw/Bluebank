import { useEffect, useRef, useState } from 'react'

// Desmos publish their demo key in the API docs. Swap in your own from
// desmos.com/api if you ever host this somewhere public.
const API_KEY = 'dcb31709b452b1cf9dc26972add0fda6'
const SRC = `https://www.desmos.com/api/v1.11/calculator.js?apiKey=${API_KEY}`

declare global {
  interface Window {
    Desmos?: { GraphingCalculator: (el: HTMLElement, opts?: object) => { destroy(): void } }
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

export function Desmos({ onClose }: { onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let calculator: { destroy(): void } | null = null
    let cancelled = false
    loadDesmos()
      .then(() => {
        if (cancelled || !host.current || !window.Desmos) return
        calculator = window.Desmos.GraphingCalculator(host.current, {
          expressionsCollapsed: false,
          border: false,
        })
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
      calculator?.destroy()
    }
  }, [])

  return (
    <div className="desmos-panel">
      <div className="desmos-head">
        <span>Graphing Calculator</span>
        <button className="nav-close" onClick={onClose} aria-label="Close calculator">×</button>
      </div>
      {error ? <p className="desmos-error">{error}</p> : <div ref={host} className="desmos-host" />}
    </div>
  )
}
