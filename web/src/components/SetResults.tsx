/**
 * The score screen a set lands on when it ends.
 *
 * Everything here comes from the set's own snapshot rather than from the
 * attempts table, so a set you finished last week still shows what you scored
 * last week even if you have answered those questions again since.
 */
import { useEffect, useState } from 'react'
import * as api from '../api'
import { Icon } from './Icon'
import { QuestionDetail } from './QuestionDetail'
import { formatClock } from '../lib/pacing'
import type { PracticeSet, SetItem } from '../types'

interface Props {
  set: PracticeSet
  /** Put one of its questions back on screen to answer again. */
  onPractice: (id: string) => void
  onRedo: (set: PracticeSet) => void
  onDelete: (id: string) => void
  onDone: () => void
}

function verdict(pct: number): string {
  if (pct >= 90) return 'good'
  if (pct >= 70) return 'mid'
  return 'poor'
}

export function SetResults({ set, onPractice, onRedo, onDelete, onDone }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [meta, setMeta] = useState<Map<string, SetItem>>(new Map())
  /**
   * Which row is expanded. Opening one reads the question back rather than
   * reopening it to answer: the set is already scored, so the useful thing here
   * is the explanation and what you did, not another go at it. Practising it
   * again is a button inside the panel.
   */
  const [open, setOpen] = useState<string | null>(null)

  // The snapshot stores ids and outcomes, not skill names. Those come from the
  // bank so the list can say what each question was about.
  useEffect(() => {
    let stale = false
    api.questionSet({})
      .then((d) => {
        if (stale) return
        setMeta(new Map(d.questions.map((q) => [q.id, q])))
      })
      .catch(() => {})
    return () => { stale = true }
  }, [])

  const items = set.items ?? []
  const pct = items.length ? Math.round((set.correct / items.length) * 100) : 0
  const missed = items.filter((i) => !i.correct)

  return (
    <div className="review">
      <button className="ghostlink" onClick={onDone}>
        <Icon name="chevron-left" size={15} strokeWidth={2.2} />
        Back
      </button>

      <header className="setdone">
        <p className="setdone-label">Set complete</p>
        <p className={`setdone-score ${verdict(pct)}`}>
          {set.correct}<span className="dim"> / {items.length}</span>
        </p>
        <p className="setdone-sub">
          {pct}% correct
          {set.seconds ? ` · ${formatClock(set.seconds)} spent` : ''}
          {set.answered < items.length
            ? ` · ${items.length - set.answered} left unanswered`
            : ''}
        </p>
        <div className="setdone-acts">
          <button className="btn primary" onClick={() => onRedo(set)}>
            Do this set again
          </button>
          {confirming ? (
            <>
              <button className="btn danger" onClick={() => onDelete(set.id)}>
                Delete for good
              </button>
              <button className="btn" onClick={() => setConfirming(false)}>Keep</button>
            </>
          ) : (
            <button className="btn" onClick={() => setConfirming(true)}>Delete</button>
          )}
        </div>

      </header>

      <h2 className="review-h">
        {missed.length
          ? `${missed.length} to look at`
          : 'Every one right'}
      </h2>

      <ul className="review-list">
        {items.map((item, i) => {
          const q = meta.get(item.question_id)
          const state = item.response === null ? 'blank' : item.correct ? 'ok' : 'no'
          const isOpen = open === item.question_id
          return (
            <li key={item.question_id}
                className={isOpen ? 'review-item open' : 'review-item'}>
              <button className="review-row"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : item.question_id)}>
                <span className="q-num">{i + 1}</span>
                <span className={`review-badge ${state === 'ok' ? 'ok' : 'no'}`}>
                  {state === 'blank' ? 'Blank' : state === 'ok' ? 'Correct' : 'Wrong'}
                </span>
                <span className="review-main">
                  <span className="review-skill">
                    {q?.skill_name ?? 'Question no longer in the bank'}
                  </span>
                  <span className="review-meta">
                    {q ? `${q.domain_name} · ${q.difficulty}` : item.question_id}
                  </span>
                </span>
                <span className="review-nums">
                  <span className="review-time">
                    {item.seconds ? formatClock(item.seconds) : '—'}
                  </span>
                </span>
                <Icon name={isOpen ? 'chevron-up' : 'chevron-down'}
                      size={16} strokeWidth={2.2} />
              </button>
              {isOpen ? (
                <QuestionDetail id={item.question_id}
                                response={item.response}
                                seconds={item.seconds}
                                onPractice={onPractice}
                                editable />
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
