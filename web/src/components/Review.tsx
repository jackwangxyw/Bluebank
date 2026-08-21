/**
 * Every question you've answered, most recent first.
 *
 * Not just the ones you got wrong: the point is being able to look back at how
 * long something took and what you were thinking, which matters on the ones you
 * got right slowly as much as the ones you missed.
 *
 * The list comes straight from the working set, which already carries the last
 * response, whether it was right, the seconds and the attempt count. Opening a
 * row fetches the body and the explanation, so nothing is loaded until asked
 * for; on the static build that is a cache hit, since you only ever answered
 * questions you had already downloaded.
 */
import { useEffect, useState } from 'react'
import * as api from '../api'
import { Explanation } from './Explanation'
import { RichText } from './RichText'
import { Icon } from './Icon'
import type {
  Annotation, GradeResult, Mistake, MistakeTag, Question, SetItem,
} from '../types'

const TAG_LABEL: Record<MistakeTag, string> = {
  process: 'Process', silly: 'Silly', knowledge: 'Knowledge', other: 'Other',
}

/** "1m 20s", because 80s is harder to read at a glance. */
function duration(seconds: number | null): string {
  if (seconds === null) return '--'
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function when(ts: number | null): string {
  if (!ts) return ''
  const then = new Date(ts * 1000)
  const days = Math.floor((Date.now() - then.getTime()) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return then.toLocaleDateString()
}

interface Props {
  onPractice: (id: string) => void
}

export function Review({ onPractice }: Props) {
  const [items, setItems] = useState<SetItem[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.reviewed()
      .then((d) => setItems(d.questions))
      .catch((e: Error) => setError(e.message))
  }, [])

  if (error) return <div className="review"><p className="review-empty">{error}</p></div>
  if (!items) return <div className="review"><p className="review-empty">Loading…</p></div>

  if (!items.length) {
    return (
      <div className="review">
        <h1 className="about-h1">Review</h1>
        <p className="review-empty">
          Nothing here yet. Answer some questions and they'll show up, with how
          long each one took.
        </p>
      </div>
    )
  }

  const totalSeconds = items.reduce((sum, i) => sum + (i.last_seconds ?? 0), 0)
  const right = items.filter((i) => i.last_correct === 1).length

  return (
    <div className="review">
      <h1 className="about-h1">Review</h1>
      <p className="review-sub">
        {items.length.toLocaleString()} answered · {right.toLocaleString()} right ·{' '}
        {duration(Math.round(totalSeconds))} spent
      </p>

      <ul className="review-list">
        {items.map((item) => (
          <li key={item.id} className="review-item">
            <button className="review-row"
                    aria-expanded={open === item.id}
                    onClick={() => setOpen(open === item.id ? null : item.id)}>
              <span className={`review-dot ${item.last_correct === 1 ? 'right' : 'wrong'}`}
                    aria-hidden="true" />
              <span className="review-main">
                <span className="review-skill">{item.skill_name}</span>
                <span className="review-meta">
                  {item.domain_name} · {when(item.answered_at)}
                  {item.attempt_count > 1 ? ` · ${item.attempt_count} tries` : ''}
                </span>
              </span>
              <span className="review-time">{duration(item.last_seconds)}</span>
              <Icon name={open === item.id ? 'chevron-up' : 'chevron-down'}
                    size={16} strokeWidth={2.2} />
            </button>
            {open === item.id ? (
              <Detail id={item.id} item={item} onPractice={onPractice} />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Detail({ id, item, onPractice }: {
  id: string; item: SetItem; onPractice: (id: string) => void
}) {
  const [data, setData] = useState<{
    question: Question; annotations: Annotation[]; mistake: Mistake | null
  } | null>(null)
  /**
   * The rationale is deliberately NOT on the question payload, so it has to be
   * asked for separately. `explain` re-grades the stored response and records
   * nothing, which is what keeps expanding a row from logging a fresh attempt.
   */
  const [result, setResult] = useState<GradeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    Promise.all([api.question(id), api.explain(id, item.last_response)])
      .then(([q, r]) => { if (!stale) { setData(q); setResult(r) } })
      .catch((e: Error) => !stale && setError(e.message))
    return () => { stale = true }
  }, [id, item.last_response])

  if (error) return <p className="review-empty">{error}</p>
  if (!data || !result) return <p className="review-empty">Loading…</p>

  return (
    <div className="review-detail">
      {data.question.stimulus_html ? (
        <div className="review-passage">
          <RichText html={data.question.stimulus_html} field="stimulus" annotations={[]} />
        </div>
      ) : null}
      <div className="review-stem">
        <RichText html={data.question.stem_html} field="stem" annotations={[]} />
      </div>

      <div className="review-facts">
        <span><strong>Your answer</strong> {item.last_response ?? 'blank'}</span>
        <span><strong>Result</strong> {item.last_correct === 1 ? 'Right' : 'Wrong'}</span>
        <span><strong>Time</strong> {duration(item.last_seconds)}</span>
      </div>

      {data.mistake ? (
        <div className="review-mistake">
          <div className="chips">
            {data.mistake.tags.map((t) => (
              <span key={t} className="chip on static">{TAG_LABEL[t]}</span>
            ))}
          </div>
          {data.mistake.note ? <p className="review-note">{data.mistake.note}</p> : null}
        </div>
      ) : null}

      {data.annotations.length ? (
        <p className="review-anns">
          {data.annotations.length} highlight{data.annotations.length === 1 ? '' : 's'} saved
          on this question.
        </p>
      ) : null}

      <Explanation result={result} question={data.question}
                   seconds={item.last_seconds ?? 0} startOpen />

      <button className="btn small" onClick={() => onPractice(id)}>
        Practice this question again
        <Icon name="arrow-right" size={14} strokeWidth={2.2} />
      </button>
    </div>
  )
}
