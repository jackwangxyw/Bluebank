/**
 * Why you got this one wrong, in your own words.
 *
 * Tags are the quick part and the note is the honest part. Both are optional:
 * clearing everything removes the log rather than storing a row of blanks, so
 * the review page can filter on "has a log" without special cases.
 *
 * Modelled on the Notes drawer so the two feel like the same control.
 */
import { useState } from 'react'
import { Icon } from './Icon'
import { MISTAKE_TAGS, type Mistake, type MistakeTag } from '../types'

const TAG_LABEL: Record<MistakeTag, string> = {
  process: 'Process',
  silly: 'Silly',
  knowledge: 'Knowledge',
  other: 'Other',
}

const TAG_HINT: Record<MistakeTag, string> = {
  process: 'Wrong method, or the right one applied in the wrong order',
  silly: 'Knew it, slipped anyway',
  knowledge: "Didn't know the thing being tested",
  other: 'Anything else',
}

interface Props {
  mistake: Mistake | null
  onSave: (tags: MistakeTag[], note: string | null) => void
  onClose: () => void
}

export function MistakeLog({ mistake, onSave, onClose }: Props) {
  // Initialised from the prop and then owned locally. App gives this a key of
  // the question id, so moving to another question remounts rather than
  // needing an effect to copy the prop back into state.
  const [tags, setTags] = useState<MistakeTag[]>(mistake?.tags ?? [])
  const [note, setNote] = useState(mistake?.note ?? '')

  function toggle(tag: MistakeTag) {
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]
    setTags(next)
    onSave(next, note.trim() || null)
  }

  return (
    <>
      <div className="nav-scrim" onClick={onClose} />
      <aside className="notes-panel" role="dialog" aria-label="Mistake log">
        <div className="notes-head">
          <span className="notes-title">Mistake log</span>
          <button className="nav-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} strokeWidth={2.2} />
          </button>
        </div>

        <div className="mlog">
          <p className="mlog-lead">
            What went wrong? Pick as many as fit.
          </p>
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

          <ul className="mlog-hints">
            {MISTAKE_TAGS.map((tag) => (
              <li key={tag}><strong>{TAG_LABEL[tag]}</strong> {TAG_HINT[tag]}</li>
            ))}
          </ul>

          <label className="mlog-label" htmlFor="mlog-note">Notes</label>
          <textarea id="mlog-note" className="mlog-note" rows={6}
                    placeholder="What you missed, and what to do next time."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onBlur={() => onSave(tags, note.trim() || null)} />
          <p className="mlog-fine">Saved automatically. Shows up on the Review page.</p>
        </div>
      </aside>
    </>
  )
}
