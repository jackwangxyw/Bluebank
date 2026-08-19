import type { SetItem } from '../types'

interface Props {
  items: SetItem[]
  current: number
  title: string
  onGo: (index: number) => void
  onClose: () => void
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

export function Navigator({ items, current, title, onGo, onClose }: Props) {
  return (
    <>
      <div className="nav-scrim" onClick={onClose} />
      <div className="nav-popup" role="dialog" aria-label="Go to question">
        <div className="nav-head">
          <div className="nav-title">{title}</div>
          <button className="nav-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="nav-legend">
          <span><i className="key key-unanswered" /> Unanswered</span>
          <span><i className="key key-first" /> Right first try</span>
          <span><i className="key key-retry" /> Right after retry</span>
          <span><i className="key key-wrong" /> Wrong</span>
          <span><i className="key key-flag">⚑</i> For Review</span>
        </div>

        <div className="nav-grid">
          {items.map((item, index) => (
            <button
              key={item.id}
              className={`nav-cell is-${cellState(item)}`}
              onClick={() => { onGo(index); onClose() }}
              title={`${item.skill_name} · ${item.difficulty}`}
            >
              {index === current ? <span className="cell-pin">⌖</span> : null}
              {item.flagged ? <span className="cell-flag">⚑</span> : null}
              {index + 1}
            </button>
          ))}
        </div>

        <div className="nav-foot">
          {items.length.toLocaleString()} questions in this set
        </div>
      </div>
    </>
  )
}
