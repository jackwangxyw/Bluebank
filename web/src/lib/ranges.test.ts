// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { applyHighlights, collectSpans } from './ranges'
import type { Annotation } from '../types'

function mount(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

function annotation(start: number, end: number, extra: Partial<Annotation> = {}): Annotation {
  return { field: 'stem', start_offset: start, end_offset: end, color: 'yellow', note: null, ...extra }
}

/** Concatenated annotatable text, i.e. the offset coordinate space. */
function space(host: HTMLElement): string {
  return collectSpans(host).spans.map((s) => s.node.nodeValue).join('')
}

describe('offset coordinate space', () => {
  it('spans multiple elements in document order', () => {
    const host = mount('<p>Alpha </p><p>Beta</p>')
    expect(space(host)).toBe('Alpha Beta')
    expect(collectSpans(host).length).toBe(10)
  })

  it('excludes MathML so typesetting cannot shift offsets', () => {
    const host = mount(
      '<p>Solve <math alttext="x squared"><mi>x</mi></math> now</p>',
    )
    expect(space(host)).toBe('Solve  now')
  })

  it('excludes svg figures and images', () => {
    const host = mount('<p>See <svg><text>ignored</text></svg><img alt="also ignored">here</p>')
    expect(space(host)).toBe('See here')
  })

  it('is unchanged after MathJax replaces math with its own container', () => {
    const host = mount('<p>Let <math><mi>x</mi></math> be <em>odd</em>.</p>')
    const before = space(host)
    // Stand-in for what MathJax does to the DOM.
    const math = host.querySelector('math')!
    const rendered = document.createElement('mjx-container')
    rendered.innerHTML = '<svg><path d="M0 0"/></svg>'
    math.replaceWith(rendered)
    expect(space(host)).toBe(before)
  })
})

describe('applyHighlights', () => {
  it('wraps the requested range and nothing else', () => {
    const host = mount('<p>The quick brown fox</p>')
    applyHighlights(host, [annotation(4, 9)])
    const mark = host.querySelector('mark.hl')!
    expect(mark.textContent).toBe('quick')
    expect(host.textContent).toBe('The quick brown fox')
  })

  it('spans an element boundary', () => {
    const host = mount('<p>Hello <em>brave</em> world</p>')
    // "lo brave wo" crosses into and out of the <em>
    applyHighlights(host, [annotation(3, 14)])
    const marks = [...host.querySelectorAll('mark.hl')]
    expect(marks.map((m) => m.textContent).join('')).toBe('lo brave wo')
    expect(host.textContent).toBe('Hello brave world')
  })

  it('keeps math out of the highlight and intact', () => {
    const host = mount('<p>If <math><mi>x</mi></math> is odd</p>')
    // Space is "If  is odd"; highlight "is odd"
    applyHighlights(host, [annotation(4, 10)])
    expect(host.querySelector('math')).not.toBeNull()
    expect(host.querySelector('mark.hl')!.textContent).toBe('is odd')
  })

  it('applies several ranges in one text node', () => {
    const host = mount('<p>alpha beta gamma</p>')
    applyHighlights(host, [annotation(0, 5), annotation(11, 16, { color: 'blue' })])
    const marks = [...host.querySelectorAll('mark.hl')]
    expect(marks.map((m) => m.textContent)).toEqual(['alpha', 'gamma'])
    expect(marks[1].className).toContain('hl-blue')
    expect(host.textContent).toBe('alpha beta gamma')
  })

  it('lets a later annotation win on the overlap without losing text', () => {
    const host = mount('<p>abcdefghij</p>')
    applyHighlights(host, [annotation(0, 6), annotation(4, 10, { color: 'pink' })])
    expect(host.textContent).toBe('abcdefghij')
    const marks = [...host.querySelectorAll('mark.hl')]
    expect(marks.map((m) => m.textContent).join('')).toBe('abcdefghij')
    expect(marks.some((m) => m.className.includes('hl-pink'))).toBe(true)
  })

  it('carries the note as a title and a marker class', () => {
    const host = mount('<p>note this</p>')
    applyHighlights(host, [annotation(0, 4, { note: 'remember', id: 7 })])
    const mark = host.querySelector('mark.hl') as HTMLElement
    expect(mark.title).toBe('remember')
    expect(mark.className).toContain('hl-note')
    expect(mark.dataset.annId).toBe('7')
  })

  it('is a no-op when there is nothing to highlight', () => {
    const host = mount('<p>untouched</p>')
    applyHighlights(host, [])
    expect(host.querySelector('mark')).toBeNull()
    expect(host.innerHTML).toBe('<p>untouched</p>')
  })

  it('ignores a range that falls outside the text', () => {
    const host = mount('<p>short</p>')
    applyHighlights(host, [annotation(100, 120)])
    expect(host.querySelector('mark')).toBeNull()
  })
})
