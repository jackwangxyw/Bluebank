/**
 * The review page a set gets in place of Bluebook's.
 *
 * On the real test the question navigator carries a "Go to Review Page" button
 * and that page is a full screen of the same grid: every question in the module,
 * marked answered, unanswered or flagged, with the legend above it. This is
 * that screen. The reference screenshot in reference/ is of the popup rather
 * than the page itself, so the grid and the legend are taken from the popup and
 * the page around them is ours.
 *
 * One deliberate difference: Bluebook cannot tell you what you got right,
 * because it grades after the module. This app grades as you answer, so the
 * cells carry the same right/retry/wrong colours the navigator uses rather than
 * a plain answered/unanswered.
 */
import { Icon } from './Icon'
import { cellState, type CellState } from './Navigator'
import type { SetItem } from '../types'

interface Props {
  items: SetItem[]
  current: number
  title: string
  /** Null when the set is untimed. */
  remaining: number | null
  clock: string | null
  onGo: (index: number) => void
  onClose: () => void
  onFinish: () => void
  /** This set's own progress, which is not the same as each question's history. */
  states?: CellState[]
}

export function SetReview({
  items, current, title, remaining, clock, onGo, onClose, onFinish, states,
}: Props) {
  const stateAt = (i: number) => states?.[i] ?? cellState(items[i])
  const unanswered = items.filter((_, i) => stateAt(i) === 'unanswered').length
  const marked = items.filter((i) => i.flagged).length

  return (
    <div className="setreview">
      <header className="setreview-top">
        <button className="ghostlink" onClick={onClose}>
          <Icon name="chevron-left" size={15} strokeWidth={2.2} />
          Back to question {current + 1}
        </button>
        {clock ? (
          <span className={remaining !== null && remaining <= 60
            ? 'setreview-clock is-low' : 'setreview-clock'}>{clock}</span>
        ) : null}
      </header>

      <div className="setreview-body">
        <h1 className="setreview-h">Check Your Work</h1>
        <p className="setreview-sub">
          {title} · {items.length} questions
          {unanswered ? ` · ${unanswered} unanswered` : ''}
          {marked ? ` · ${marked} marked` : ''}
        </p>

        <div className="nav-legend setreview-legend">
          <span><i className="key key-unanswered" /> Unanswered</span>
          <span><i className="key key-first" /> Correct first try</span>
          <span><i className="key key-retry" /> Correct after retry</span>
          <span><i className="key key-wrong" /> Incorrect</span>
          <span><i className="key key-marked" /> Marked</span>
        </div>

        <div className="nav-grid setreview-grid">
          {items.map((item, i) => (
            <button
              key={item.id}
              className={`nav-cell is-${stateAt(i)}`
                + (i === current ? ' is-current' : '')
                + (item.flagged ? ' is-flagged' : '')}
              onClick={() => { onGo(i); onClose() }}
              title={`${item.skill_name} · ${item.difficulty}`}
            >
              {i + 1}
            </button>
          ))}
        </div>

        <div className="setreview-foot">
          <button className="btn primary lg" onClick={onFinish}>
            Finish set
            <Icon name="arrow-right" size={18} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>
  )
}
