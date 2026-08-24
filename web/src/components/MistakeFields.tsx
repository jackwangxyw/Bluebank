/**
 * The tags and the note, without any chrome around them.
 *
 * Two places ask why you got one wrong: the drawer in MistakeLog, and the
 * expanded row on a finished set's score screen. They want identical controls
 * in very different containers, so the controls live here and each caller
 * supplies its own wrapper.
 */
import { useState } from 'react'
import { MISTAKE_TAGS, type Mistake, type MistakeTag } from '../types'

export const TAG_LABEL: Record<MistakeTag, string> = {
  process: 'Process',
  silly: 'Silly',
  knowledge: 'Knowledge',
  other: 'Other',
}

export const TAG_HINT: Record<MistakeTag, string> = {
  process: 'Wrong method, or the right one applied in the wrong order',
  silly: 'Knew it, slipped anyway',
  knowledge: "Didn't know the thing being tested",
  other: 'Anything else',
}

interface Props {
  mistake: Mistake | null
  onSave: (tags: MistakeTag[], note: string | null) => void
  lead?: string
  /** Distinguishes the note fields when more than one is on the page. */
  id?: string
}

export function MistakeFields({ mistake, onSave, lead, id = 'mlog-note' }: Props) {
  // Initialised from the prop and then owned locally, so callers key this by
  // question id rather than copying the prop back into state on every change.
  const [tags, setTags] = useState<MistakeTag[]>(mistake?.tags ?? [])
  const [note, setNote] = useState(mistake?.note ?? '')

  function toggle(tag: MistakeTag) {
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]
    setTags(next)
    onSave(next, note.trim() || null)
  }

  return (
    <>
      <p className="mlog-lead">{lead ?? 'What went wrong? Pick as many as fit.'}</p>
      <div className="chips">
        {MISTAKE_TAGS.map((tag) => (
          <button key={tag}
                  className={tags.includes(tag) ? 'chip on' : 'chip'}
                  aria-pressed={tags.includes(tag)}
                  title={TAG_HINT[tag]}
                  onClick={() => toggle(tag)}>
            {TAG_LABEL[tag]}
          </button>
        ))}
      </div>

      <label className="mlog-label" htmlFor={id}>Notes</label>
      <textarea id={id} className="mlog-note" rows={6}
                placeholder="What you missed, and what to do next time."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={() => onSave(tags, note.trim() || null)} />
    </>
  )
}
