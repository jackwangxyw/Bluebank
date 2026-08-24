/**
 * Why you got this one wrong, in your own words.
 *
 * Tags are the quick part and the note is the honest part. Both are optional:
 * clearing everything removes the log rather than storing a row of blanks, so
 * the review page can filter on "has a log" without special cases.
 *
 * Modelled on the Notes drawer so the two feel like the same control. The
 * controls themselves are in MistakeFields, shared with the score screen.
 *
 * This drawer is for free practice, where the verdict is on screen the moment
 * you answer. A set hides its verdict until it ends, so a set logs its
 * mistakes from the score screen instead.
 */
import { Icon } from './Icon'
import { MistakeFields } from './MistakeFields'
import type { Mistake, MistakeTag } from '../types'

interface Props {
  mistake: Mistake | null
  onSave: (tags: MistakeTag[], note: string | null) => void
  onClose: () => void
}

export function MistakeLog({ mistake, onSave, onClose }: Props) {
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
          <MistakeFields mistake={mistake} onSave={onSave} />
          <p className="mlog-fine">Saved automatically. Shows up on the Review page.</p>
        </div>
      </aside>
    </>
  )
}
