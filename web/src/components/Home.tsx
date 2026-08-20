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
  { key: 'RW', label: 'Reading and Writing', blurb: 'Information and Ideas, Craft and Structure, Expression of Ideas, Standard English Conventions' },
  { key: 'MATH', label: 'Math', blurb: 'Algebra, Advanced Math, Problem-Solving and Data Analysis, Geometry and Trigonometry' },
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
    const map = new Map<string, { name: string; n: number }>()
    for (const row of taxonomy) {
      if (value.section && row.section !== value.section) continue
      const entry = map.get(row.domain)
      map.set(row.domain, { name: row.domain_name, n: (entry?.n ?? 0) + row.n })
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

  function set(patch: Partial<Filters>) { onChange({ ...value, ...patch }) }

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-head">
          <h1>SAT Bluebank</h1>
          <p className="home-sub">
            {total.toLocaleString()} official College Board questions, with their
            own explanations.
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
          <h2>Question bank</h2>
          <div className="cards">
            <button
              className={!value.section ? 'card on' : 'card'}
              onClick={() => set({ section: undefined, domain: undefined, skill: undefined })}
            >
              <span className="card-t">Everything</span>
              <span className="card-b">Both sections, mixed</span>
            </button>
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                className={value.section === s.key ? 'card on' : 'card'}
                onClick={() => set({ section: s.key, domain: undefined, skill: undefined })}
              >
                <span className="card-t">{s.label}</span>
                <span className="card-b">{s.blurb}</span>
              </button>
            ))}
          </div>
        </section>

        <div className="field-row">
          <section className="field">
            <h2>Domain</h2>
            <div className="selectwrap">
              <select value={value.domain ?? ''}
                      onChange={(e) => set({ domain: e.target.value || undefined, skill: undefined })}>
                <option value="">All domains</option>
                {domains.map(([code, d]) => (
                  <option key={code} value={code}>{d.name} · {d.n}</option>
                ))}
              </select>
              <Icon name="chevron-down" size={16} className="selecticon" />
            </div>
          </section>

          <section className="field">
            <h2>Skill</h2>
            <div className="selectwrap">
              <select value={value.skill ?? ''} disabled={!value.domain}
                      onChange={(e) => set({ skill: e.target.value || undefined })}>
                <option value="">{value.domain ? 'All skills' : 'Pick a domain first'}</option>
                {skills.map(([code, s]) => (
                  <option key={code} value={code}>{s.name} · {s.n}</option>
                ))}
              </select>
              <Icon name="chevron-down" size={16} className="selecticon" />
            </div>
          </section>
        </div>

        <div className="field-row">
          <section className="field">
            <h2>Difficulty</h2>
            <div className="pills">
              <button className={!value.difficulty ? 'pill on' : 'pill'}
                      onClick={() => set({ difficulty: undefined })}>Any</button>
              {DIFFICULTIES.map((d) => (
                <button key={d.key}
                        className={value.difficulty === d.key ? 'pill on' : 'pill'}
                        onClick={() => set({ difficulty: d.key })}>{d.label}</button>
              ))}
            </div>
          </section>

          <section className="field">
            <h2>Your history</h2>
            <div className="pills">
              <button className={!value.status ? 'pill on' : 'pill'}
                      onClick={() => set({ status: undefined })}>Any</button>
              {STATUSES.map((s) => (
                <button key={s.key}
                        className={value.status === s.key ? 'pill on' : 'pill'}
                        onClick={() => set({ status: s.key })}>{s.label}</button>
              ))}
            </div>
          </section>
        </div>

        <div className="home-foot">
          <span className="count">
            {loading ? 'Counting…' : `${count.toLocaleString()} question${count === 1 ? '' : 's'} selected`}
          </span>
          <button className="btn primary lg" disabled={!count || loading} onClick={onStart}>
            Start practicing
            <Icon name="arrow-right" size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
