import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import type { Annotation } from '../types'

interface Props {
  annotations: Annotation[]
  onRemove: (id: number) => void
  onClose: () => void
}

const FIELD_LABEL: Record<string, string> = {
  stimulus: 'Passage',
  stem: 'Question',
  why_wrong: 'Explanation',
  why_right: 'Explanation',
  rationale: 'Explanation',
}

function fieldLabel(field: string): string {
  if (FIELD_LABEL[field]) return FIELD_LABEL[field]
  if (field.startsWith('option:')) return `Choice ${field.slice(7)}`
  return field
}

/**
 * Bluebook's Highlights & Notes panel: everything you marked on this question,
 * with its note, and a way to remove it.
 *
 * The highlighted text is read back out of the DOM rather than stored on the
 * annotation. Annotations are (field, start, end) offsets with no copy of the
 * text, and RichText already tags every rendered mark with data-ann-id, so the
 * text is a query away and there is no schema change and nothing to keep in
 * sync. It re-reads whenever the panel opens or the annotation list changes.
 */
export function Notes({ annotations, onRemove, onClose }: Props) {
  const [quotes, setQuotes] = useState<Record<number, string>>({})

  useEffect(() => {
    const found: Record<number, string> = {}
    for (const annotation of annotations) {
      if (annotation.id === undefined) continue
      // One annotation can be split across several marks when it spans an
      // element boundary, so join every piece back together.
      const marks = document.querySelectorAll(`mark[data-ann-id="${annotation.id}"]`)
      const text = [...marks].map((m) => m.textContent ?? '').join('').trim()
      if (text) found[annotation.id] = text
    }
    setQuotes(found)
  }, [annotations])

  const sorted = [...annotations].sort(
    (a, b) => a.field.localeCompare(b.field) || a.start_offset - b.start_offset,
  )

  return (
    <>
      <div className="nav-scrim" onClick={onClose} />
      <aside className="notes-panel" role="dialog" aria-label="Highlights and notes">
        <div className="notes-head">
          <div className="notes-title">Highlights &amp; Notes</div>
          <button className="nav-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>

        {sorted.length ? (
          <ul className="notes-list">
            {sorted.map((annotation) => (
              <li key={annotation.id} className="note-item">
                <div className="note-item-head">
                  <span className={`note-swatch sw-${annotation.color}`} />
                  <span className="note-where">{fieldLabel(annotation.field)}</span>
                  <button className="note-del"
                          onClick={() => annotation.id && onRemove(annotation.id)}
                          title="Remove">
                    <Icon name="trash" size={15} />
                  </button>
                </div>
                <blockquote className="note-quote">
                  {annotation.id !== undefined && quotes[annotation.id]
                    ? quotes[annotation.id]
                    : <em className="note-missing">highlighted text</em>}
                </blockquote>
                {annotation.note ? (
                  <p className="note-text">{annotation.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="notes-empty">
            <p>Nothing marked on this question yet.</p>
            <p className="note small">
              Select any text in the passage, the question, or an answer choice
              to highlight it or attach a note.
            </p>
          </div>
        )}
      </aside>
    </>
  )
}
