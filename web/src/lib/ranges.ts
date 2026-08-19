/**
 * Anchoring highlights to text.
 *
 * Offsets are measured over the concatenated text of the annotatable text
 * nodes under a root, in document order. Math, figures, and images are skipped
 * entirely, so MathJax replacing a <math> element with an <mjx-container> full
 * of SVG cannot shift a single offset. The question HTML itself is fixed (it
 * comes from the database), so these offsets stay valid across reloads.
 */
import type { Annotation } from '../types'

/** Elements whose text is not part of the annotatable coordinate space. */
const OPAQUE = new Set(['MATH', 'SVG', 'IMG', 'SCRIPT', 'STYLE', 'MJX-CONTAINER'])

function isOpaque(node: Node | null): boolean {
  for (let n = node; n; n = n.parentNode) {
    if (n.nodeType === Node.ELEMENT_NODE && OPAQUE.has((n as Element).tagName.toUpperCase())) {
      return true
    }
  }
  return false
}

export interface TextSpan {
  node: Text
  start: number   // global offset of this node's first character
}

/** Annotatable text nodes with their global start offsets, in document order. */
export function collectSpans(root: HTMLElement): { spans: TextSpan[]; length: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT
      return isOpaque(node.parentNode) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    },
  })
  const spans: TextSpan[] = []
  let length = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    spans.push({ node: text, start: length })
    length += text.nodeValue!.length
  }
  return { spans, length }
}

/** Global offset for a (node, offset) DOM position, or null if outside. */
function positionToOffset(spans: TextSpan[], node: Node, offset: number): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const span = spans.find((s) => s.node === node)
    return span ? span.start + offset : null
  }
  // An element boundary: resolve to the first text node at or after it.
  const children = Array.from(node.childNodes)
  const target = children[offset] ?? children[children.length - 1]
  if (!target) return null
  const span = spans.find((s) => s.node === target || target.contains(s.node))
  return span ? span.start : null
}

/** The current selection as offsets into `root`, or null if unusable. */
export function selectionToOffsets(root: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null

  const { spans } = collectSpans(root)
  const start = positionToOffset(spans, range.startContainer, range.startOffset)
  const end = positionToOffset(spans, range.endContainer, range.endOffset)
  if (start === null || end === null || end <= start) return null
  return { start, end }
}

/**
 * Wrap annotated ranges in <mark> elements.
 *
 * Each text node is rebuilt in one pass from a per-character map, so
 * overlapping annotations and multiple ranges in one node are handled without
 * any node-splitting order to get wrong.
 */
export function applyHighlights(root: HTMLElement, annotations: Annotation[]): void {
  if (!annotations.length) return
  const { spans } = collectSpans(root)

  for (const span of spans) {
    const text = span.node.nodeValue!
    const nodeStart = span.start
    const nodeEnd = nodeStart + text.length

    const owner: (Annotation | null)[] = new Array(text.length).fill(null)
    let touched = false
    for (const annotation of annotations) {
      const from = Math.max(annotation.start_offset, nodeStart)
      const to = Math.min(annotation.end_offset, nodeEnd)
      if (to <= from) continue
      touched = true
      for (let i = from - nodeStart; i < to - nodeStart; i++) owner[i] = annotation
    }
    if (!touched) continue

    const fragment = document.createDocumentFragment()
    let cursor = 0
    while (cursor < text.length) {
      const current = owner[cursor]
      let end = cursor + 1
      while (end < text.length && owner[end] === current) end++
      const slice = text.slice(cursor, end)
      if (current === null) {
        fragment.appendChild(document.createTextNode(slice))
      } else {
        const mark = document.createElement('mark')
        mark.className = `hl hl-${current.color}${current.note ? ' hl-note' : ''}`
        mark.dataset.annId = String(current.id ?? '')
        if (current.note) mark.title = current.note
        mark.textContent = slice
        fragment.appendChild(mark)
      }
      cursor = end
    }
    span.node.parentNode?.replaceChild(fragment, span.node)
  }
}

/** Offsets of the annotation covering a click target, if any. */
export function annotationIdAt(target: EventTarget | null): number | null {
  const element = target as HTMLElement | null
  const mark = element?.closest?.('mark.hl') as HTMLElement | null
  if (!mark) return null
  const id = Number(mark.dataset.annId)
  return Number.isFinite(id) && id > 0 ? id : null
}
