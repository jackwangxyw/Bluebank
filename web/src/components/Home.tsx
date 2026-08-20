import { useMemo } from 'react'
import { Icon } from './Icon'
import type { Filters, Section, Stats, TaxonomyRow } from '../types'

interface Props {
  taxonomy: TaxonomyRow[]
  stats: Stats | null
  value: Filters
  count: number
  loading: boolean
  onChange: (next: Filters) => void
  onStart: () => void
}

const SECTIONS: { key: Section; label: string; blurb: string }[] = [
  { key: 'RW', label: 'Reading and Writing', blurb: 'Passages, vocabulary, evidence, grammar' },
  { key: 'MATH', label: 'Math', blurb: 'Algebra, advanced math, data, geometry' },
]

const DIFFICULTIES = [
  { key: 'E', label: 'Easy' },
  { key: 'M', label: 'Medium' },
  { key: 'H', label: 'Hard' },
] as const

const STATUSES = [
  { key: 'unseen', label: 'Unseen' },
  { key: 'wrong', label: 'Got wrong' },
  { key: 'correct', label: 'Got right' },
  { key: 'flagged', label: 'Marked' },
] as const

export function Home({ taxonomy, stats, value, count, loading, onChange, onStart }: Props) {
  const domains = useMemo(() => {
    const map = new Map<string, { name: string; n: number; section: Section }>()
    for (const row of taxonomy) {
      if (value.section && row.section !== value.section) continue
      const entry = map.get(row.domain)
      map.set(row.domain, {
        name: row.domain_name, n: (entry?.n ?? 0) + row.n, section: row.section,
      })
    }
    return [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
  }, [taxonomy, value.section])

  const skills = useMemo(() => {
    if (!value.domain) return []
    const map = new Map<string, { name: string; n: number }>()
    for (const row of taxonomy) {
      if (row.domain !== value.domain) continue
      const entry = map.get(row.skill)
      map.set(row.skill, { name: row.skill_name, n: (entry?.n ?? 0) + row.n })
    }
    return [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
  }, [taxonomy, value.domain])

  const total = useMemo(
    () => taxonomy.reduce((sum, row) => sum + row.n, 0), [taxonomy])

  const sectionCounts = useMemo(() => {
    const map = new Map<Section, number>()
    for (const row of taxonomy) map.set(row.section, (map.get(row.section) ?? 0) + row.n)
    return map
  }, [taxonomy])

  const dirty = Boolean(
    value.section || value.domain || value.skill || value.difficulty || value.status)

  function set(patch: Partial<Filters>) { onChange({ ...value, ...patch }) }

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-head">
          <h1>SAT Bluebank</h1>
          <p className="home-sub">
            {total.toLocaleString()} official College Board questions with explanations
          </p>
        </header>

        {stats && stats.attempts > 0 ? (
          <div className="statrow">
            <div className="stat">
              <span className="stat-n">{stats.attempts.toLocaleString()}</span>
              <span className="stat-l">Answered</span>
            </div>
            <div className="stat">
              <span className="stat-n">{stats.correct.toLocaleString()}</span>
              <span className="stat-l">Correct</span>
            </div>
            <div className="stat">
              <span className="stat-n">
                {stats.accuracy !== null ? `${Math.round(stats.accuracy * 100)}%` : '—'}
              </span>
              <span className="stat-l">Accuracy</span>
            </div>
          </div>
        ) : null}

        <section className="field">
          <div className="field-head">
            <h2>Section</h2>
            {dirty ? (
              <button className="reset" onClick={() => onChange({})}>
                <Icon name="close" size={13} strokeWidth={2.4} />
                Clear all
              </button>
            ) : null}
          </div>
          <div className="cards">
            <button
              className={!value.section ? 'card on' : 'card'}
              onClick={() => set({ section: undefined, domain: undefined, skill: undefined })}
            >
              <span className="card-t">Everything</span>
              <span className="card-b">Both sections, mixed together</span>
              <span className="card-n">{total.toLocaleString()}</span>
            </button>
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                className={value.section === s.key ? 'card on' : 'card'}
                onClick={() => set({ section: s.key, domain: undefined, skill: undefined })}
              >
                <span className="card-t">{s.label}</span>
                <span className="card-b">{s.blurb}</span>
                <span className="card-n">{(sectionCounts.get(s.key) ?? 0).toLocaleString()}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="field">
          <div className="field-head"><h2>Domain</h2></div>
          <div className="chips">
            <button className={!value.domain ? 'chip on' : 'chip'}
                    onClick={() => set({ domain: undefined, skill: undefined })}>
              All domains
            </button>
            {domains.map(([code, d]) => (
              <button key={code}
                      className={value.domain === code ? 'chip on' : 'chip'}
                      onClick={() => set({ domain: code, skill: undefined })}>
                {d.name}
                <span className="chip-n">{d.n}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="field">
          <div className="field-head"><h2>Skill</h2></div>
          {value.domain ? (
            <div className="chips">
              <button className={!value.skill ? 'chip on' : 'chip'}
                      onClick={() => set({ skill: undefined })}>
                All skills
              </button>
              {skills.map(([code, s]) => (
                <button key={code}
                        className={value.skill === code ? 'chip on' : 'chip'}
                        onClick={() => set({ skill: code })}>
                  {s.name}
                  <span className="chip-n">{s.n}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="field-hint">Pick a domain to narrow down to a single skill.</p>
          )}
        </section>

        <div className="field-row">
          <section className="field">
            <div className="field-head"><h2>Difficulty</h2></div>
            <div className="segmented">
              <button className={!value.difficulty ? 'seg on' : 'seg'}
                      onClick={() => set({ difficulty: undefined })}>Any</button>
              {DIFFICULTIES.map((d) => (
                <button key={d.key}
                        className={value.difficulty === d.key ? 'seg on' : 'seg'}
                        onClick={() => set({ difficulty: d.key })}>{d.label}</button>
              ))}
            </div>
          </section>

          <section className="field">
            <div className="field-head"><h2>Your history</h2></div>
            <div className="segmented">
              <button className={!value.status ? 'seg on' : 'seg'}
                      onClick={() => set({ status: undefined })}>Any</button>
              {STATUSES.map((s) => (
                <button key={s.key}
                        className={value.status === s.key ? 'seg on' : 'seg'}
                        onClick={() => set({ status: s.key })}>{s.label}</button>
              ))}
            </div>
          </section>
        </div>

        <div className="home-foot">
          <span className="count">
            {loading ? 'Counting…' : (
              <>
                <strong>{count.toLocaleString()}</strong>
                {` question${count === 1 ? '' : 's'} in this set`}
              </>
            )}
          </span>
          <button className="btn primary lg" disabled={!count || loading} onClick={onStart}>
            Start practicing
            <Icon name="arrow-right" size={18} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>
  )
}
