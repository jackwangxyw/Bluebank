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
 * Give every table its own horizontal scroller.
 *
 * A figure scales down to fit a phone, but a table can't: the widest in the
 * bank is 7 columns and wants 728px, and squeezing that into 390px makes it
 * unreadable. Scrolling it inside its own box keeps the sideways drag on the
 * table instead of taking the whole question with it.
 *
 * Done here rather than with `display: block; overflow-x: auto` in CSS, which
 * looks like it should work and doesn't: it hands the table's sizing to an
 * anonymous box that stretches to fill, so a two-column table went from 95px to
 * the full width of the pane. The table has to stay a real table to shrink to
 * fit its own contents.
 *
 * A wrapper element adds no text node and reorders none, so the offsets every
 * saved highlight is anchored to are untouched (lib/ranges.ts).
 */
function wrapTables(host: HTMLElement): void {
  for (const table of host.querySelectorAll('table')) {
    const wrap = document.createElement('div')
    wrap.className = 'tablewrap'
    table.replaceWith(wrap)
    wrap.appendChild(table)
  }
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
    wrapTables(host)
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

  // `richtext` is always on, so the rules for official markup (figures that have
  // to scale, tables that have to scroll) key off the renderer rather than off a
  // list of its callers. Review and Explanation pass no className at all and
  // were getting none of them.
  return (
    <div
      ref={ref}
      className={className ? `richtext ${className}` : 'richtext'}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
    />
  )
}
