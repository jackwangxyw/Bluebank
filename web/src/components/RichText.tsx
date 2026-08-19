import { useEffect, useRef } from 'react'
import { applyHighlights, selectionToOffsets } from '../lib/ranges'
import { typeset } from '../lib/mathjax'
import type { Annotation } from '../types'

interface Props {
  html: string
  field: string
  annotations?: Annotation[]
  onSelect?: (range: { field: string; start: number; end: number }) => void
  onAnnotationClick?: (id: number) => void
  className?: string
}

/**
 * Renders official question HTML: MathML, inline SVG figures, tables, and
 * base64 images all arrive as-is from the bank.
 *
 * Order matters. Highlights are applied while the math is still <math>, then
 * MathJax replaces it; because the offset space skips math entirely, typesetting
 * cannot move a highlight.
 */
export function RichText({
  html, field, annotations = [], onSelect, onAnnotationClick, className,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = ref.current
    if (!host) return
    host.innerHTML = html
    applyHighlights(host, annotations.filter((a) => a.field === field))
    void typeset(host)
  }, [html, field, annotations])

  function handleMouseUp() {
    if (!onSelect || !ref.current) return
    const offsets = selectionToOffsets(ref.current)
    if (!offsets) return
    onSelect({ field, start: offsets.start, end: offsets.end })
  }

  function handleClick(event: React.MouseEvent) {
    if (!onAnnotationClick) return
    const mark = (event.target as HTMLElement).closest?.('mark.hl') as HTMLElement | null
    const id = mark ? Number(mark.dataset.annId) : NaN
    if (Number.isFinite(id) && id > 0) onAnnotationClick(id)
  }

  return (
    <div
      ref={ref}
      className={className}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
    />
  )
}
