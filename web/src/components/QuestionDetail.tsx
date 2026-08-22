/**
 * One answered question, read back.
 *
 * The panel behind a row on the Review page and behind a row on a finished
 * set's score screen. Both want the same thing: the question, every attempt at
 * it, whatever you logged about it, and the explanation already open, since you
 * came here to read the reasoning rather than to be told the verdict.
 *
 * `response` is the answer being reviewed, and it is not always the latest one.
 * On the Review page it is the last attempt; inside a set it is the answer that
 * set recorded, which is what makes a set you finished last week still read
 * back as it scored. `explain` re-grades whatever it is handed and records
 * nothing, so opening a row never logs a fresh attempt.
 */
import { useEffect, useState } from 'react'
import * as api from '../api'
import { Explanation } from './Explanation'
import { RichText } from './RichText'
import { Icon } from './Icon'
import { duration } from '../lib/pacing'
import type {
  Annotation, Attempt, GradeResult, Mistake, MistakeTag, Question,
} from '../types'

const TAG_LABEL: Record<MistakeTag, string> = {
  process: 'Process', silly: 'Silly', knowledge: 'Knowledge', other: 'Other',
}

const clock = (ts: number | null) => (ts
  ? new Date(ts * 1000).toLocaleString(undefined,
    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  : '')

interface Props {
  id: string
  /** The answer being reviewed. Null where the question was left blank. */
  response: string | null
  seconds: number
  onPractice: (id: string) => void
  /** Feeds Review's "Has a note" filter. Absent where nothing tracks it. */
  onLogged?: (id: string, has: boolean) => void
}

export function QuestionDetail({ id, response, seconds, onPractice, onLogged }: Props) {
  const [data, setData] = useState<{
    question: Question; annotations: Annotation[]; mistake: Mistake | null
  } | null>(null)
  /**
   * The rationale is deliberately NOT on the question payload, so it has to be
   * asked for separately.
   */
  const [result, setResult] = useState<GradeResult | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [showPassage, setShowPassage] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    Promise.all([
      api.question(id),
      api.explain(id, response),
      api.attemptsFor(id),
    ])
      .then(([q, r, a]) => {
        if (stale) return
        setData(q); setResult(r); setAttempts(a.attempts)
        onLogged?.(id, Boolean(q.mistake))
      })
      .catch((e: Error) => !stale && setError(e.message))
    return () => { stale = true }
  }, [id, response, onLogged])

  if (error) return <p className="review-empty">{error}</p>
  if (!data || !result) return <p className="review-empty">Loading…</p>

  const hasLog = Boolean(data.mistake
    && (data.mistake.tags.length || data.mistake.note))

  return (
    <div className="review-detail">
      {/* The passage is the longest thing here and you usually remember it, so
          it starts folded and the question stays at the top of the panel. */}
      {data.question.stimulus_html ? (
        <>
          <button className="btn small review-toggle"
                  onClick={() => setShowPassage((v) => !v)}>
            {showPassage ? 'Hide passage' : 'Show passage'}
            <Icon name={showPassage ? 'chevron-up' : 'chevron-down'}
                  size={14} strokeWidth={2.2} />
          </button>
          {showPassage ? (
            <div className="review-passage">
              <RichText html={data.question.stimulus_html} field="stimulus" annotations={[]} />
            </div>
          ) : null}
        </>
      ) : null}

      <div className="review-stem">
        <RichText html={data.question.stem_html} field="stem" annotations={[]} />
      </div>

      {/* The explanation below talks about the choices by letter, so without
          the choices themselves "Why B is wrong" says nothing. Same markup and
          the same three colours practice uses once you have answered: green is
          the key, red is a wrong pick, the blue ring is what you chose. */}
      {data.question.type === 'mcq' && data.question.options ? (
        <ul className="choices static">
          {data.question.options.map((option) => {
            const isPicked = response === option.label
            const isKey = result.accepted.includes(option.label)
            return (
              <li key={option.label}
                  className={[
                    'choice',
                    isPicked ? 'picked' : '',
                    isKey ? 'is-key' : '',
                    isPicked && !isKey ? 'is-wrongpick' : '',
                  ].filter(Boolean).join(' ')}>
                <div className="choice-main">
                  <span className="bubble">{option.label}</span>
                  <RichText className="choice-text" html={option.html}
                            field={`option:${option.label}`} annotations={[]} />
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}

      <h4 className="review-h">Your attempts</h4>
      <div className="review-tablewrap">
        <table className="review-table">
          <thead>
            <tr><th>#</th><th>When</th><th>Answer</th><th>Result</th><th>Time</th></tr>
          </thead>
          <tbody>
            {attempts.map((a, i) => (
              <tr key={a.id ?? i}>
                <td>{i + 1}</td>
                <td>{clock(a.answered_at)}</td>
                <td className="review-ans">{a.response || 'blank'}</td>
                <td className={a.correct ? 'ok' : 'no'}>{a.correct ? 'Correct' : 'Incorrect'}</td>
                <td>{duration(a.seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Nothing logged means nothing to show. An empty section was just noise
          on every question you never wrote anything about. */}
      {hasLog ? (
        <>
          <h4 className="review-h">Mistake log</h4>
          <div className="review-mistake">
            {data.mistake!.tags.length ? (
              <div className="chips">
                {data.mistake!.tags.map((t) => (
                  <span key={t} className="chip on static">{TAG_LABEL[t]}</span>
                ))}
              </div>
            ) : null}
            {data.mistake!.note ? (
              <p className="review-note">{data.mistake!.note}</p>
            ) : null}
          </div>
        </>
      ) : null}

      {data.annotations.length ? (
        <p className="review-anns">
          {data.annotations.length} highlight{data.annotations.length === 1 ? '' : 's'} saved
          on this question.
        </p>
      ) : null}

      <Explanation result={result} question={data.question}
                   seconds={seconds} startOpen />

      <button className="btn small review-again" onClick={() => onPractice(id)}>
        Practice this question again
        <Icon name="arrow-right" size={14} strokeWidth={2.2} />
      </button>
    </div>
  )
}
