/**
 * Every question you've answered.
 *
 * Not just the ones you got wrong: the point is being able to look back at how
 * long something took and what you were thinking, which matters on the ones you
 * got right slowly as much as the ones you missed.
 *
 * Grouped section, then day, then difficulty. Reading and Maths are studied
 * separately, so they are separated here; the day says which sitting it was;
 * and easy-to-hard within a day is the order you would want to skim.
 *
 * The list comes straight from the working set, which already carries the last
 * response, whether it was right, the seconds and the attempt count. Opening a
 * row fetches the body, the explanation and the full attempt history, so
 * nothing is loaded until asked for; on the static build that is a cache hit,
 * since you only ever answered questions you had already downloaded.
 */
import { useCallback, useEffect, useState } from 'react'
import * as api from '../api'
import { QuestionDetail } from './QuestionDetail'
import { Icon } from './Icon'
import { describeSet } from '../lib/setlabel'
import { duration, formatClock } from '../lib/pacing'
import type { PracticeSet, Section, SetItem } from '../types'

const SECTION_LABEL: Record<Section, string> = {
  RW: 'Reading and Writing', MATH: 'Math',
}

const DIFFICULTY: Record<string, string> = { E: 'Easy', M: 'Medium', H: 'Hard' }
/** Easy first, hard last. */
const DIFFICULTY_RANK: Record<string, number> = { E: 0, M: 1, H: 2 }

/**
 * Right first time, right eventually, and wrong are three different results.
 * The navigator grid has always drawn them as green / amber / red; this matches
 * it so the two views cannot disagree.
 *
 * "Retried" rather than "Correct after retry": the badge is a fixed-width pill
 * in a row, and the longer phrase wrapped to three lines. The amber already
 * says it was eventually right, and the row shows the attempt count beside it.
 */
function verdict(item: SetItem): { cls: string; label: string } {
  if (item.last_correct !== 1) return { cls: 'wrong', label: 'Incorrect' }
  if (item.attempt_count > 1) return { cls: 'retry', label: 'Retried' }
  return { cls: 'right', label: 'Correct' }
}

/** Day headings, so a long history reads as sittings rather than one wall. */
function dayKey(ts: number | null): string {
  if (!ts) return 'Earlier'
  const then = new Date(ts * 1000)
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const days = Math.floor((midnight.getTime() - then.getTime()) / 86400000) + 1
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'This week'
  if (days < 30) return 'This month'
  return then.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

type Filter = 'all' | 'incorrect' | 'logged'

const FILTERS: [Filter, string][] = [
  ['all', 'All'], ['incorrect', 'Incorrect'], ['logged', 'Has a note'],
]

interface Props {
  onPractice: (id: string) => void
  /** Open a finished set's score screen. */
  onOpenSet: (id: string) => void
  onDeleteSet: (id: string) => void
}

export function Review({ onPractice, onOpenSet, onDeleteSet }: Props) {
  const [sets, setSets] = useState<PracticeSet[] | null>(null)
  const [items, setItems] = useState<SetItem[] | null>(null)
  /** Which questions have a mistake log. Filled in as rows are opened. */
  const [logged, setLogged] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * Stable identity, and it returns the previous Set unchanged when nothing
   * moved. Both matter: Detail calls this from an effect, so a new closure or a
   * new Set every time would re-render the parent, hand Detail a new callback,
   * and re-run the effect forever.
   */
  const markLogged = useCallback((qid: string, has: boolean) => {
    setLogged((prev) => {
      if (has === prev.has(qid)) return prev
      const next = new Set(prev)
      if (has) next.add(qid)
      else next.delete(qid)
      return next
    })
  }, [])

  useEffect(() => {
    api.reviewed()
      .then((d) => setItems(d.questions))
      .catch((e: Error) => setError(e.message))
    // Up front, not as rows are opened: a filter that only knows about what you
    // already clicked is not a filter.
    api.loggedIds()
      .then((d) => setLogged(new Set(d.question_ids)))
      .catch(() => { /* the filter degrades to empty, the page still works */ })
    // Finished sets. A failure leaves the section out rather than the page.
    api.listSets(false)
      .then(setSets)
      .catch(() => setSets([]))
  }, [])

  /** Finished sets, newest first. Rendered above the per-question history. */
  const setHistory = sets?.length ? (
    <section className="review-section">
      <h2 className="review-sectionhead">Practice sets</h2>
      <ul className="setlist">
        {sets.map((s) => {
          const pct = s.total ? Math.round((s.correct / s.total) * 100) : 0
          return (
            <li key={s.id} className="setcard">
              <button className="setcard-main" onClick={() => onOpenSet(s.id)}>
                <span className="setcard-text">
                  <span className="setcard-t">{describeSet(s)}</span>
                  <span className="setcard-b">
                    {new Date((s.finished_at ?? s.created_at) * 1000)
                      .toLocaleDateString(undefined,
                        { month: 'short', day: 'numeric', year: 'numeric' })}
                    {s.seconds ? ` · ${formatClock(s.seconds)}` : ''}
                  </span>
                </span>
                <span className={`setcard-score ${pct >= 90 ? 'good' : pct >= 70 ? 'mid' : 'poor'}`}>
                  {s.correct}<span className="dim">/{s.total}</span>
                </span>
              </button>
              <span className="setcard-side">
                <button className="setcard-drop"
                        title="Delete this set"
                        onClick={() => {
                          setSets((prev) => prev?.filter((x) => x.id !== s.id) ?? prev)
                          onDeleteSet(s.id)
                        }}>
                  <Icon name="trash" size={15} strokeWidth={2} />
                </button>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  ) : null

  if (error) return <div className="review"><p className="review-empty">{error}</p></div>
  if (!items) return <div className="review"><p className="review-empty">Loading…</p></div>

  if (!items.length) {
    return (
      <div className="review">
        <h1 className="about-h1">Review</h1>
        {setHistory}
        <p className="review-empty">
          Nothing here yet. Answer some questions and they'll show up, with how
          long each one took.
        </p>
      </div>
    )
  }

  const shown = items.filter((i) => (
    filter === 'incorrect' ? i.last_correct !== 1
      : filter === 'logged' ? logged.has(i.id)
        : true))

  // Section, then day, then easy to hard. The list arrives newest first, so the
  // days keep that order simply by being met in turn.
  const sections: {
    section: Section
    days: { label: string; rows: SetItem[] }[]
  }[] = []
  for (const item of shown) {
    let group = sections.find((s) => s.section === item.section)
    if (!group) { group = { section: item.section, days: [] }; sections.push(group) }
    const label = dayKey(item.answered_at)
    let day = group.days.find((d) => d.label === label)
    if (!day) { day = { label, rows: [] }; group.days.push(day) }
    day.rows.push(item)
  }
  sections.sort((a, b) => (a.section === 'RW' ? -1 : 1) - (b.section === 'RW' ? -1 : 1))
  for (const group of sections) {
    for (const day of group.days) {
      day.rows.sort((a, b) => (
        (DIFFICULTY_RANK[a.difficulty] ?? 9) - (DIFFICULTY_RANK[b.difficulty] ?? 9)
        || (b.answered_at ?? 0) - (a.answered_at ?? 0)))
    }
  }

  const correct = items.filter((i) => i.last_correct === 1).length
  const total = items.reduce((sum, i) => sum + (i.last_seconds ?? 0), 0)

  return (
    <div className="review">
      <h1 className="about-h1">Review</h1>
      <p className="review-sub">
        {items.length.toLocaleString()} answered · {correct.toLocaleString()} correct ·{' '}
        {duration(Math.round(total))} spent
      </p>

      {setHistory}

      <div className="chips review-filter">
        {FILTERS.map(([key, label]) => (
          <button key={key} className={filter === key ? 'chip on' : 'chip'}
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}>{label}</button>
        ))}
      </div>

      {!shown.length ? (
        <p className="review-empty">Nothing matches this filter.</p>
      ) : null}

      {sections.map((group) => (
        <section key={group.section} className="review-section">
          <h2 className="review-sectionhead">{SECTION_LABEL[group.section]}</h2>
          {group.days.map((day) => (
            <div key={day.label} className="review-group">
              <h3 className="review-day">{day.label}</h3>
              <ul className="review-list">
                {day.rows.map((item) => (
                  <li key={item.id}
                      className={open === item.id ? 'review-item open' : 'review-item'}>
                    <button className="review-row"
                            aria-expanded={open === item.id}
                            onClick={() => setOpen(open === item.id ? null : item.id)}>
                      {/* Correct on the third go is not the same as correct
                          first time, and the navigator already says so in
                          amber. Same three states, same colours. */}
                      <span className={`review-badge ${verdict(item).cls}`}>
                        {verdict(item).label}
                      </span>
                      <span className="review-main">
                        <span className="review-skill">{item.skill_name}</span>
                        <span className="review-meta">
                          {item.domain_name} · {DIFFICULTY[item.difficulty] ?? item.difficulty}
                        </span>
                      </span>
                      <span className="review-nums">
                        <span className="review-time">{duration(item.last_seconds)}</span>
                        {item.attempt_count > 1 ? (
                          <span className="review-tries">{item.attempt_count} tries</span>
                        ) : null}
                      </span>
                      <Icon name={open === item.id ? 'chevron-up' : 'chevron-down'}
                            size={16} strokeWidth={2.2} />
                    </button>
                    {open === item.id ? (
                      <QuestionDetail id={item.id}
                                      response={item.last_response}
                                      seconds={item.last_seconds ?? 0}
                                      onPractice={onPractice}
                                      onLogged={markLogged} />
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
