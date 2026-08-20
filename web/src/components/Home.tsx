import { Fragment, useMemo, useState } from 'react'
import { Icon } from './Icon'
import type { Difficulty, Filters, Section, Stats, TaxonomyRow } from '../types'

interface Props {
  taxonomy: TaxonomyRow[]
  stats: Stats | null
  value: Filters
  count: number
  loading: boolean
  onChange: (next: Filters) => void
  onStart: () => void
}

/** 'ALL' is a real choice, distinct from having chosen nothing yet. */
type Picked = 'ALL' | Section | null

const SECTIONS: { key: Section; label: string; blurb: string }[] = [
  { key: 'RW', label: 'Reading and Writing', blurb: 'Passages, vocabulary in context, evidence, grammar' },
  { key: 'MATH', label: 'Math', blurb: 'Algebra, advanced math, data analysis, geometry' },
]

const DIFFICULTIES: { key: Difficulty; label: string }[] = [
  { key: 'E', label: 'Easy' },
  { key: 'M', label: 'Medium' },
  { key: 'H', label: 'Hard' },
]

const STATUSES = [
  { key: 'unseen', label: 'Not yet seen' },
  { key: 'wrong', label: 'Got wrong' },
  { key: 'correct', label: 'Got right' },
  { key: 'flagged', label: 'Marked' },
] as const

const SECTION_NAME: Record<Section, string> = {
  RW: 'Reading and Writing',
  MATH: 'Math',
}

interface DomainRow {
  code: string
  name: string
  section: Section
  n: number
  seen: number
}

export function Home({ taxonomy, stats, value, count, loading, onChange, onStart }: Props) {
  /**
   * Which section card is chosen, held locally because the filter cannot say
   * it: `section: undefined` means "every question", which is what the
   * Everything card selects, and it also means "nothing chosen yet". Those are
   * different states and the page opens in the second one.
   */
  const [picked, setPicked] = useState<Picked>(null)

  const domains = useMemo(() => {
    const map = new Map<string, DomainRow>()
    for (const row of taxonomy) {
      if (value.section && row.section !== value.section) continue
      const entry = map.get(row.domain) ?? {
        code: row.domain, name: row.domain_name, section: row.section, n: 0, seen: 0,
      }
      entry.n += row.n
      entry.seen += row.seen
      map.set(row.domain, entry)
    }
    // Reading and Writing is section 1 on the real test, so it leads.
    const order: Record<Section, number> = { RW: 0, MATH: 1 }
    return [...map.values()].sort(
      (a, b) => order[a.section] - order[b.section] || a.name.localeCompare(b.name),
    )
  }, [taxonomy, value.section])

  const skills = useMemo(() => {
    if (!value.domain) return []
    const map = new Map<string, { code: string; name: string; n: number; seen: number }>()
    for (const row of taxonomy) {
      if (row.domain !== value.domain) continue
      const entry = map.get(row.skill) ?? { code: row.skill, name: row.skill_name, n: 0, seen: 0 }
      entry.n += row.n
      entry.seen += row.seen
      map.set(row.skill, entry)
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [taxonomy, value.domain])

  const totals = useMemo(() => {
    const out = {
      all: 0, seen: 0,
      RW: 0, MATH: 0,
      seenRW: 0, seenMATH: 0,
      correct: 0, correctRW: 0, correctMATH: 0,
    }
    for (const row of taxonomy) {
      out.all += row.n
      out.seen += row.seen
      out.correct += row.correct
      out[row.section] += row.n
      out[row.section === 'RW' ? 'seenRW' : 'seenMATH'] += row.seen
      out[row.section === 'RW' ? 'correctRW' : 'correctMATH'] += row.correct
    }
    return out
  }, [taxonomy])

  function set(patch: Partial<Filters>) { onChange({ ...value, ...patch }) }

  /** Clicking the chosen card again clears everything and collapses the page. */
  function choose(next: Exclude<Picked, null>) {
    if (picked === next) {
      setPicked(null)
      onChange({})
      return
    }
    setPicked(next)
    onChange({ section: next === 'ALL' ? undefined : next })
  }

  interface Card {
    key: Exclude<Picked, null>
    n: number
    seen: number
    correct: number
    label: string
    blurb: string
  }
  const cards: Card[] = [
    {
      key: 'ALL', n: totals.all, seen: totals.seen, correct: totals.correct,
      label: 'Everything', blurb: 'Both sections, shuffled together',
    },
    ...SECTIONS.map((s) => ({
      key: s.key as Exclude<Picked, null>,
      n: totals[s.key],
      seen: s.key === 'RW' ? totals.seenRW : totals.seenMATH,
      correct: s.key === 'RW' ? totals.correctRW : totals.correctMATH,
      label: s.label,
      blurb: s.blurb,
    })),
  ]

  return (
    <div className="home">
      <div className="home-inner">
        <header className="hero">
          <h1 className="hero-title">Build a practice set</h1>
          <p className="hero-sub">
            {totals.all.toLocaleString()} official College Board questions with explanations
          </p>

          {stats && stats.attempts > 0 ? (
            <div className="progress">
              <div className="progress-head">
                <span className="label">Bank covered</span>
                <span className="progress-n">
                  {totals.seen.toLocaleString()}
                  <span className="dim"> / {totals.all.toLocaleString()}</span>
                  <span className="progress-sep">·</span>
                  {stats.accuracy !== null ? `${Math.round(stats.accuracy * 100)}%` : '—'} correct
                </span>
              </div>
              <span className="meter">
                <span className="meter-fill"
                      style={{ width: `${Math.max(totals.all ? (totals.seen / totals.all) * 100 : 0, 0.4)}%` }} />
              </span>
            </div>
          ) : null}
        </header>

        <section className="pick">
          <h2 className="label">Section</h2>
          <div className="cards">
            {cards.map((c) => {
              const covered = c.n ? (c.seen / c.n) * 100 : 0
              return (
                <button key={c.key}
                        className={picked === c.key ? 'card on' : 'card'}
                        aria-pressed={picked === c.key}
                        onClick={() => choose(c.key)}>
                  <span className="card-top">
                    <span className="card-n">{c.n.toLocaleString()}</span>
                    <span className="card-tag">questions</span>
                  </span>
                  <span className="card-t">{c.label}</span>
                  <span className="card-b">{c.blurb}</span>
                  <span className="card-foot">
                    <span className="card-meter"
                          title={`${c.seen} of ${c.n} attempted`}>
                      <span className="card-meter-fill"
                            style={{ width: `${Math.max(covered, c.seen ? 1.5 : 0)}%` }} />
                    </span>
                    <span className="card-stat">
                      {c.seen
                        ? `${c.seen.toLocaleString()} done · ${Math.round((c.correct / c.seen) * 100)}%`
                        : 'Not started'}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {/* Everything below appears only once a section is chosen, and each row
            in turn as the choice above it is made. */}
        {picked ? (
          <section className="refine">
            <div className="row">
              <h2 className="label">Domain</h2>
              <div className="chips">
                <button className={!value.domain ? 'chip on' : 'chip'}
                        onClick={() => set({ domain: undefined, skill: undefined })}>
                  All
                </button>
                {domains.map((d, i) => (
                  <Fragment key={d.code}>
                    {picked === 'ALL' && (i === 0 || domains[i - 1].section !== d.section) ? (
                      <>
                        {i > 0 ? <span className="brk" /> : null}
                        <span className="cap">{SECTION_NAME[d.section]}</span>
                        <span className="brk" />
                      </>
                    ) : null}
                    <button className={value.domain === d.code ? 'chip on' : 'chip'}
                            onClick={() => set({ domain: d.code, skill: undefined })}>
                      {d.name}
                      <span className="chip-n">{d.n}</span>
                      <span className="chip-meter"
                            style={{ transform: `scaleX(${d.n ? d.seen / d.n : 0})` }} />
                    </button>
                  </Fragment>
                ))}
              </div>
            </div>

            {value.domain ? (
              <div className="row">
                <h2 className="label">Skill</h2>
                <div className="chips">
                  <button className={!value.skill ? 'chip on' : 'chip'}
                          onClick={() => set({ skill: undefined })}>
                    All
                  </button>
                  {skills.map((s) => (
                    <button key={s.code}
                            className={value.skill === s.code ? 'chip on' : 'chip'}
                            onClick={() => set({ skill: s.code })}>
                      {s.name}
                      <span className="chip-n">{s.n}</span>
                      <span className="chip-meter"
                            style={{ transform: `scaleX(${s.n ? s.seen / s.n : 0})` }} />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="row">
              <h2 className="label">Difficulty</h2>
              <div className="chips">
                <button className={!value.difficulty ? 'chip on' : 'chip'}
                        onClick={() => set({ difficulty: undefined })}>Any</button>
                {DIFFICULTIES.map((d) => (
                  <button key={d.key}
                          className={value.difficulty === d.key ? 'chip on' : 'chip'}
                          onClick={() => set({ difficulty: d.key })}>{d.label}</button>
                ))}
              </div>
            </div>

            <div className="row">
              <h2 className="label">History</h2>
              <div className="chips">
                <button className={!value.status ? 'chip on' : 'chip'}
                        onClick={() => set({ status: undefined })}>Any</button>
                {STATUSES.map((s) => (
                  <button key={s.key}
                          className={value.status === s.key ? 'chip on' : 'chip'}
                          onClick={() => set({ status: s.key })}>{s.label}</button>
                ))}
              </div>
            </div>
          </section>
        ) : null}
      </div>

      {picked ? (
        <div className="startbar">
          <div className="startbar-inner">
            <span className="count">
              {loading ? 'Counting…' : (
                <>
                  <strong>{count.toLocaleString()}</strong>
                  {` question${count === 1 ? '' : 's'} selected`}
                </>
              )}
            </span>
            <button className="btn primary lg" disabled={!count || loading} onClick={onStart}>
              Start practicing
              <Icon name="arrow-right" size={18} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
