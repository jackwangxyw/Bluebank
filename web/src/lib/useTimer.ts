import { useEffect, useRef, useState } from 'react'

/**
 * Elapsed time on one question.
 *
 * Restarts whenever `key` changes and stops when `running` goes false, which is
 * the moment you answer. Time does not accrue while the tab is hidden, so a
 * question left open overnight does not record as an eight-hour attempt.
 */
export function useQuestionTimer(key: string | null, running: boolean) {
  const [seconds, setSeconds] = useState(0)
  const accumulated = useRef(0)
  const since = useRef<number | null>(null)

  // Reset for a new question.
  useEffect(() => {
    accumulated.current = 0
    since.current = null
    setSeconds(0)
  }, [key])

  useEffect(() => {
    if (!running || !key) {
      if (since.current !== null) {
        accumulated.current += (Date.now() - since.current) / 1000
        since.current = null
      }
      return
    }

    const resume = () => { if (since.current === null) since.current = Date.now() }
    const pause = () => {
      if (since.current !== null) {
        accumulated.current += (Date.now() - since.current) / 1000
        since.current = null
      }
    }

    if (document.visibilityState === 'visible') resume()
    const onVisibility = () => (document.visibilityState === 'visible' ? resume() : pause())
    document.addEventListener('visibilitychange', onVisibility)

    const tick = window.setInterval(() => {
      const live = since.current === null ? 0 : (Date.now() - since.current) / 1000
      setSeconds(accumulated.current + live)
    }, 250)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(tick)
      pause()
      setSeconds(accumulated.current)
    }
  }, [key, running])

  return Math.round(seconds)
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(s / 60)
  const seconds = s % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
