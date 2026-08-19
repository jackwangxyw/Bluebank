import { useMemo } from 'react'
import type { Filters as FilterState, Section, TaxonomyRow } from '../types'

interface Props {
  taxonomy: TaxonomyRow[]
  value: FilterState
  count: number
  onChange: (next: FilterState) => void
}

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'RW', label: 'Reading and Writing' },
  { key: 'MATH', label: 'Math' },
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
  { key: 'flagged', label: 'Marked for review' },
] as const

export function Filters({ taxonomy, value, count, onChange }: Props) {
  const domains = useMemo(() => {
    const map = new Map<string, { name: string; section: Section; n: number }>()
    for (const row of taxonomy) {
      if (value.section && row.section !== value.section) continue
      const entry = map.get(row.domain)
      map.set(row.domain, {
        name: row.domain_name,
        section: row.section,
        n: (entry?.n ?? 0) + row.n,
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

  function set(patch: Partial<FilterState>) {
    onChange({ ...value, ...patch })
  }

  return (
    <div className="filters">
      <div className="filter-group">
        <label>Section</label>
        <div className="chips">
          <button className={!value.section ? 'chip on' : 'chip'}
                  onClick={() => set({ section: undefined, domain: undefined, skill: undefined })}>
            All
          </button>
          {SECTIONS.map((s) => (
            <button key={s.key}
                    className={value.section === s.key ? 'chip on' : 'chip'}
                    onClick={() => set({ section: s.key, domain: undefined, skill: undefined })}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <label>Domain</label>
        <select value={value.domain ?? ''}
                onChange={(e) => set({ domain: e.target.value || undefined, skill: undefined })}>
          <option value="">All domains</option>
          {domains.map(([code, d]) => (
            <option key={code} value={code}>{d.name} ({d.n})</option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label>Skill</label>
        <select value={value.skill ?? ''}
                disabled={!value.domain}
                onChange={(e) => set({ skill: e.target.value || undefined })}>
          <option value="">All skills</option>
          {skills.map(([code, s]) => (
            <option key={code} value={code}>{s.name} ({s.n})</option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label>Difficulty</label>
        <div className="chips">
          <button className={!value.difficulty ? 'chip on' : 'chip'}
                  onClick={() => set({ difficulty: undefined })}>All</button>
          {DIFFICULTIES.map((d) => (
            <button key={d.key}
                    className={value.difficulty === d.key ? 'chip on' : 'chip'}
                    onClick={() => set({ difficulty: d.key })}>
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <label>History</label>
        <div className="chips">
          <button className={!value.status ? 'chip on' : 'chip'}
                  onClick={() => set({ status: undefined })}>Any</button>
          {STATUSES.map((s) => (
            <button key={s.key}
                    className={value.status === s.key ? 'chip on' : 'chip'}
                    onClick={() => set({ status: s.key })}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-count">{count.toLocaleString()} questions</div>
    </div>
  )
}
