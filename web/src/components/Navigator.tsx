import { Icon } from './Icon'
import type { SetItem } from '../types'

interface Props {
  items: SetItem[]
  current: number
  title: string
  onGo: (index: number) => void
  onClose: () => void
  /**
   * Only a practice set has one. Bluebook puts this button in exactly this
   * spot, under the grid, and it is how you reach the end-of-module review
   * page; open practice has no end to review, so it has no button.
   */
  onReviewPage?: () => void
  /**
   * Cell state per question, when the caller knows better than the question's
   * own history does. A practice set does: its cells have to show how THIS set
   * is going, not whether you happened to answer the same question last week.
   */
  states?: CellState[]
}

export type CellState = 'unanswered' | 'first' | 'retry' | 'wrong'

/**
 * White until you answer, green if you got it first time, yellow if it took
 * more than one go, red if your latest attempt was wrong.
 */
export function cellState(item: SetItem): CellState {
  const attempts = item.attempt_count ?? 0
  if (!attempts || item.last_correct === null) return 'unanswered'
  if (item.last_correct === 0) return 'wrong'
  return attempts > 1 ? 'retry' : 'first'
}

export function Navigator({
  items, current, title, onGo, onClose, onReviewPage, states,
}: Props) {
  return (
    <>
      <div className="nav-scrim" onClick={onClose} />
      <div className="nav-popup" role="dialog" aria-label="Go to question">
        <div className="nav-head">
          <div className="nav-title">{title}</div>
          <button className="nav-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="nav-legend">
          <span><i className="key key-unanswered" /> Unanswered</span>
          <span><i className="key key-first" /> Correct first try</span>
          <span><i className="key key-retry" /> Correct after retry</span>
          <span><i className="key key-wrong" /> Incorrect</span>
          <span><i className="key key-marked" /> Marked</span>
        </div>

        <div className="nav-grid">
          {items.map((item, index) => (
            <button
              key={item.id}
              className={`nav-cell is-${states?.[index] ?? cellState(item)}`
                + (index === current ? ' is-current' : '')
                + (item.flagged ? ' is-flagged' : '')}
              onClick={() => { onGo(index); onClose() }}
              title={`${item.skill_name} · ${item.difficulty}`}
            >
              {index + 1}
            </button>
          ))}
        </div>

        <div className="nav-foot">
          {onReviewPage ? (
            <button className="btn nav-review" onClick={onReviewPage}>
              Go to Review Page
            </button>
          ) : null}
          <span>{items.length.toLocaleString()} questions in this set</span>
        </div>
      </div>
    </>
  )
}
