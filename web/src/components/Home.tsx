import { useMemo } from 'react'
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

/**
 * Colour carries information here, it is not decoration: each section owns a
 * hue, and every domain chip inherits its section's hue, so which half of the
 * test you are looking at is readable at a glance without reading a word.
 */
const SECTIONS: { key: Section; label: string; blurb: string }[] = [
  {
    key: 'RW',
    label: 'Reading and Writing',
    blurb: 'Passages, vocabulary in context, evidence, and grammar',
  },
  {
    key: 'MATH',
    label: 'Math',
    blurb: 'Algebra, advanced math, data analysis, and geometry',
  },
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

interface DomainRow {
  code: string
  name: string
  section: Section
  n: number
  seen: number
}

export function Home({ taxonomy, stats, value, count, loading, onChange, onStart }: Props) {
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
    // Reading and Writing is section 1 on the real test, so it leads. Sorting
    // by the section code would put MATH first, which reads backwards.
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
      const entry = map.get(row.skill)
        ?? { code: row.skill, name: row.skill_name, n: 0, seen: 0 }
      entry.n += row.n
      entry.seen += row.seen
      map.set(row.skill, entry)
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [taxonomy, value.domain])

  const totals = useMemo(() => {
    const out = { all: 0, seen: 0, RW: 0, MATH: 0 }
    for (const row of taxonomy) {
      out.all += row.n
      out.seen += row.seen
      out[row.section] += row.n
    }
    return out
  }, [taxonomy])

  const dirty = Boolean(
    value.section || value.domain || value.skill || value.difficulty || value.status)
  const sectionOf = (key: Section | 'ALL') => (key === 'ALL' ? 'all' : key.toLowerCase())

  function set(patch: Partial<Filters>) { onChange({ ...value, ...patch }) }

  const covered = totals.all ? Math.round((totals.seen / totals.all) * 100) : 0

  return (
    <div className="home">
      <div className="home-inner">
        <header className="hero">
          <div className="hero-id">
            <h1 className="hero-title">SAT Bluebank</h1>
            <p className="hero-sub">
              {totals.all.toLocaleString()} official College Board questions with explanations
            </p>
          </div>

          {stats && stats.attempts > 0 ? (
            <div className="hero-stats">
              <div className="hero-progress">
                <div className="hero-progress-head">
                  <span className="hero-progress-label">Bank covered</span>
                  <span className="hero-progress-value">
                    {totals.seen.toLocaleString()}
                    <span className="dim"> / {totals.all.toLocaleString()}</span>
                  </span>
                </div>
                <div className="meter" role="img"
                     aria-label={`${covered}% of the bank attempted`}>
                  <span className="meter-fill" style={{ width: `${Math.max(covered, 1)}%` }} />
                </div>
              </div>
              <div className="hero-figure">
                <span className="hero-figure-n">
                  {stats.accuracy !== null ? `${Math.round(stats.accuracy * 100)}%` : '—'}
                </span>
                <span className="hero-figure-l">Accuracy</span>
              </div>
              <div className="hero-figure">
                <span className="hero-figure-n">{stats.attempts.toLocaleString()}</span>
                <span className="hero-figure-l">Answered</span>
              </div>
            </div>
          ) : null}
        </header>

        <section className="field">
          <div className="field-head">
            <h2>Section</h2>
            {dirty ? (
              <button className="reset" onClick={() => onChange({})}>
                <Icon name="close" size={13} strokeWidth={2.4} />
                Clear
              </button>
            ) : null}
          </div>
          <div className="cards">
            <button className={`card tone-all${!value.section ? ' on' : ''}`}
                    onClick={() => set({ section: undefined, domain: undefined, skill: undefined })}>
              <span className="card-n">{totals.all.toLocaleString()}</span>
              <span className="card-t">Everything</span>
              <span className="card-b">Both sections, shuffled together</span>
            </button>
            {SECTIONS.map((s) => (
              <button key={s.key}
                      className={`card tone-${sectionOf(s.key)}${value.section === s.key ? ' on' : ''}`}
                      onClick={() => set({ section: s.key, domain: undefined, skill: undefined })}>
                <span className="card-n">{totals[s.key].toLocaleString()}</span>
                <span className="card-t">{s.label}</span>
                <span className="card-b">{s.blurb}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="field">
          <div className="field-head"><h2>Domain</h2></div>
          <div className="chips">
            <button className={`chip tone-all${!value.domain ? ' on' : ''}`}
                    onClick={() => set({ domain: undefined, skill: undefined })}>
              All domains
            </button>
            {domains.map((d) => (
              <button key={d.code}
                      className={`chip tone-${sectionOf(d.section)}${value.domain === d.code ? ' on' : ''}`}
                      onClick={() => set({ domain: d.code, skill: undefined })}>
                <span className="chip-label">{d.name}</span>
                <span className="chip-n">{d.n}</span>
                {/* How much of this domain you have attempted, as a hairline. */}
                <span className="chip-meter"
                      style={{ transform: `scaleX(${d.n ? d.seen / d.n : 0})` }} />
              </button>
            ))}
          </div>
        </section>

        <section className="field">
          <div className="field-head"><h2>Skill</h2></div>
          {value.domain ? (
            <div className="chips">
              <button className={`chip tone-all${!value.skill ? ' on' : ''}`}
                      onClick={() => set({ skill: undefined })}>
                All skills
              </button>
              {skills.map((s) => (
                <button key={s.code}
                        className={`chip tone-${sectionOf(value.section ?? 'ALL')}${value.skill === s.code ? ' on' : ''}`}
                        onClick={() => set({ skill: s.code })}>
                  <span className="chip-label">{s.name}</span>
                  <span className="chip-n">{s.n}</span>
                  <span className="chip-meter"
                        style={{ transform: `scaleX(${s.n ? s.seen / s.n : 0})` }} />
                </button>
              ))}
            </div>
          ) : (
            <p className="field-hint">Pick a domain to narrow down to one skill.</p>
          )}
        </section>

        <div className="field-row">
          <section className="field">
            <div className="field-head"><h2>Difficulty</h2></div>
            <div className="chips">
              <button className={`chip tone-all${!value.difficulty ? ' on' : ''}`}
                      onClick={() => set({ difficulty: undefined })}>Any</button>
              {DIFFICULTIES.map((d) => (
                <button key={d.key}
                        className={`chip diff-${d.key}${value.difficulty === d.key ? ' on' : ''}`}
                        onClick={() => set({ difficulty: d.key })}>
                  <span className="diff-dot" />
                  {d.label}
                </button>
              ))}
            </div>
          </section>

          <section className="field">
            <div className="field-head"><h2>Your history</h2></div>
            <div className="chips">
              <button className={`chip tone-all${!value.status ? ' on' : ''}`}
                      onClick={() => set({ status: undefined })}>Any</button>
              {STATUSES.map((s) => (
                <button key={s.key}
                        className={`chip tone-all${value.status === s.key ? ' on' : ''}`}
                        onClick={() => set({ status: s.key })}>{s.label}</button>
              ))}
            </div>
          </section>
        </div>
      </div>

      <div className="startbar">
        <div className="startbar-inner">
          <span className="count">
            {loading ? 'Counting…' : (
              <>
                <strong>{count.toLocaleString()}</strong>
                {` question${count === 1 ? '' : 's'} ready`}
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
