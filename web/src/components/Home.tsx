import { useMemo, useState } from 'react'
import { Icon } from './Icon'
import { SPEEDS, setSeconds, formatClock } from '../lib/pacing'
import { describeSet } from '../lib/setlabel'
import type {
  Difficulty, Filters, PracticeSet, Section, Stats, TaxonomyRow,
} from '../types'

interface Props {
  taxonomy: TaxonomyRow[]
  stats: Stats | null
  value: Filters
  count: number
  loading: boolean
  onChange: (next: Filters) => void
  onStart: () => void
  /** Sets still being worked through, oldest first. */
  activeSets: PracticeSet[]
  onResume: (id: string) => void
  onAbandon: (id: string) => void
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
  { key: 'unseen', label: 'Not seen' },
  { key: 'wrong', label: 'Incorrect' },
  { key: 'correct', label: 'Correct' },
  { key: 'flagged', label: 'Marked' },
] as const

/** Offered set sizes. `null` is the default: the whole pool, no set at all. */
const SIZES: (number | null)[] = [null, 10, 20, 30, 50]

interface DomainRow {
  code: string
  name: string
  section: Section
  n: number
  seen: number
}

export function Home({
  taxonomy, stats, value, count, loading, onChange, onStart,
  activeSets, onResume, onAbandon,
}: Props) {
  /**
   * Which section card is chosen, held locally because the filter cannot say
   * it: `section: undefined` means "every question", which is what the
   * Everything card selects, and it also means "nothing chosen yet". Those are
   * different states and the page opens in the second one.
   */
  const [picked, setPicked] = useState<Picked>(null)
  /** The custom-size box, held as text so it can be empty while you type. */
  const [custom, setCustom] = useState('')

  /**
   * How long the clock would be for this set, priced per question from the real
   * test's own pace. Uses the sections actually available, so an all-Math set
   * gets Math's 95 seconds a question rather than a blend.
   */
  const plannedSeconds = useMemo(() => {
    if (!value.size || !value.speed) return 0
    const section: Section = value.section ?? 'RW'
    const mix: Section[] = value.section
      ? Array.from({ length: value.size }, () => section)
      // Everything: assume the draw lands in proportion to the pool, which is
      // near enough half and half and only decides what the clock says.
      : Array.from({ length: value.size }, (_, i) => (i % 2 ? 'MATH' : 'RW'))
    return setSeconds(mix, value.speed)
  }, [value.size, value.speed, value.section])

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

  /** Skills for every selected domain, tagged so they can be pruned later. */
  const skills = useMemo(() => {
    const chosen = value.domains ?? []
    if (!chosen.length) return []
    const map = new Map<string, {
      code: string; name: string; domain: string; n: number; seen: number
    }>()
    for (const row of taxonomy) {
      if (!chosen.includes(row.domain)) continue
      const entry = map.get(row.skill)
        ?? { code: row.skill, name: row.skill_name, domain: row.domain, n: 0, seen: 0 }
      entry.n += row.n
      entry.seen += row.seen
      map.set(row.skill, entry)
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [taxonomy, value.domains])

  const totals = useMemo(() => {
    const out = {
      all: 0, seen: 0, live: 0,
      RW: 0, MATH: 0,
      seenRW: 0, seenMATH: 0,
      correct: 0, correctRW: 0, correctMATH: 0,
    }
    for (const row of taxonomy) {
      out.all += row.n
      out.seen += row.seen
      out.live += row.live_n ?? 0
      out.correct += row.correct
      out[row.section] += row.n
      out[row.section === 'RW' ? 'seenRW' : 'seenMATH'] += row.seen
      out[row.section === 'RW' ? 'correctRW' : 'correctMATH'] += row.correct
    }
    return out
  }, [taxonomy])

  function set(patch: Partial<Filters>) { onChange({ ...value, ...patch }) }

  /**
   * Add or remove one value from a filter list.
   *
   * Returns undefined rather than [] when the last value comes out, because
   * "no filter" and "an empty filter" have to be the same thing: an empty array
   * would otherwise read as "match nothing" and the All chip would not light up.
   */
  function toggle<T>(list: T[] | undefined, item: T): T[] | undefined {
    const next = list?.includes(item)
      ? list.filter((x) => x !== item)
      : [...(list ?? []), item]
    return next.length ? next : undefined
  }

  /**
   * Turning a domain off has to take its skills with it. Leaving them behind
   * gives you a filter for a skill you can no longer see a chip for, and the
   * set silently comes back empty.
   */
  function toggleDomain(code: string) {
    const domains = toggle(value.domains, code)
    const stillVisible = new Set(
      taxonomy.filter((r) => (domains ?? []).includes(r.domain)).map((r) => r.skill),
    )
    const kept = (value.skills ?? []).filter((s) => stillVisible.has(s))
    set({ domains, skills: kept.length ? kept : undefined })
  }

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

        {activeSets.length ? (
          <section className="pick">
            <h2 className="label">Sets in progress</h2>
            <ul className="setlist">
              {activeSets.map((s) => (
                <li key={s.id} className="setcard">
                  <button className="setcard-main" onClick={() => onResume(s.id)}>
                    <span className="setcard-text">
                      <span className="setcard-t">{describeSet(s)}</span>
                      <span className="setcard-b">
                        {s.answered} of {s.total} answered
                      </span>
                      <span className="meter">
                        <span className="meter-fill"
                              style={{ width: `${Math.max((s.answered / Math.max(s.total, 1)) * 100, 0.4)}%` }} />
                      </span>
                    </span>
                    <span className="setcard-go">Resume</span>
                  </button>
                  <span className="setcard-side">
                    <button className="setcard-drop" onClick={() => onAbandon(s.id)}
                            title="Discard this set">
                      <Icon name="trash" size={15} strokeWidth={2} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

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
              {picked === 'ALL' ? (
                /* One column per section rather than one long stack. The two
                   sections are read separately, and side by side they fit on a
                   screen instead of pushing everything below the fold. */
                <>
                <div className="chips domain-all">
                  <button className={!value.domains?.length ? 'chip on' : 'chip'}
                          onClick={() => set({ domains: undefined, skills: undefined })}>
                    All
                  </button>
                </div>
                <div className="domain-cols">
                  {SECTIONS.map((sec) => (
                    <div key={sec.key} className="domain-col">
                      <span className="cap">{sec.label}</span>
                      <div className="chips">
                        {domains.filter((d) => d.section === sec.key).map((d) => (
                          <button key={d.code}
                                  className={value.domains?.includes(d.code) ? 'chip on' : 'chip'}
                                  aria-pressed={value.domains?.includes(d.code) ?? false}
                                  onClick={() => toggleDomain(d.code)}>
                            {d.name}
                            <span className="chip-n">{d.n}</span>
                            <span className="chip-meter"
                                  style={{ transform: `scaleX(${d.n ? d.seen / d.n : 0})` }} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                </>
              ) : (
                <div className="chips">
                  <button className={!value.domains?.length ? 'chip on' : 'chip'}
                          onClick={() => set({ domains: undefined, skills: undefined })}>
                    All
                  </button>
                  {domains.map((d) => (
                    <button key={d.code}
                            className={value.domains?.includes(d.code) ? 'chip on' : 'chip'}
                            aria-pressed={value.domains?.includes(d.code) ?? false}
                            onClick={() => toggleDomain(d.code)}>
                      {d.name}
                      <span className="chip-n">{d.n}</span>
                      <span className="chip-meter"
                            style={{ transform: `scaleX(${d.n ? d.seen / d.n : 0})` }} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {value.domains?.length ? (
              <div className="row">
                <h2 className="label">Skill</h2>
                <div className="chips">
                  <button className={!value.skills?.length ? 'chip on' : 'chip'}
                          onClick={() => set({ skills: undefined })}>
                    All
                  </button>
                  {skills.map((s) => (
                    <button key={s.code}
                            className={value.skills?.includes(s.code) ? 'chip on' : 'chip'}
                            aria-pressed={value.skills?.includes(s.code) ?? false}
                            onClick={() => set({ skills: toggle(value.skills, s.code) })}>
                      {s.name}
                      <span className="chip-n">{s.n}</span>
                      <span className="chip-meter"
                            style={{ transform: `scaleX(${s.n ? s.seen / s.n : 0})` }} />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="row row-pair">
              <div className="pair-half">
                <h2 className="label">Difficulty</h2>
                <div className="chips">
                  <button className={!value.difficulties?.length ? 'chip on' : 'chip'}
                          onClick={() => set({ difficulties: undefined })}>Any</button>
                  {DIFFICULTIES.map((d) => (
                    <button key={d.key}
                            className={value.difficulties?.includes(d.key) ? 'chip on' : 'chip'}
                            aria-pressed={value.difficulties?.includes(d.key) ?? false}
                            onClick={() => set({ difficulties: toggle(value.difficulties, d.key) })}>
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pair-half">
                <h2 className="label">History</h2>
                <div className="chips">
                  <button className={!value.statuses?.length ? 'chip on' : 'chip'}
                          onClick={() => set({ statuses: undefined })}>Any</button>
                  {STATUSES.map((st) => (
                    <button key={st.key}
                            className={value.statuses?.includes(st.key) ? 'chip on' : 'chip'}
                            aria-pressed={value.statuses?.includes(st.key) ?? false}
                            onClick={() => set({ statuses: toggle(value.statuses, st.key) })}>
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="row">
              <h2 className="label">Set size</h2>
              <div className="chips">
                {SIZES.map((n) => (
                  <button key={String(n)}
                          className={(value.size ?? null) === n ? 'chip on' : 'chip'}
                          aria-pressed={(value.size ?? null) === n}
                          onClick={() => set({ size: n ?? undefined })}>
                    {n === null ? 'All' : n}
                  </button>
                ))}
                <label className="chip chip-input">
                  <span>Custom</span>
                  <input type="number" min={1} max={count || undefined}
                         value={custom}
                         placeholder="0"
                         onChange={(e) => {
                           setCustom(e.target.value)
                           const n = Number(e.target.value)
                           set({ size: Number.isFinite(n) && n > 0 ? Math.min(n, count) : undefined })
                         }} />
                </label>
              </div>
            </div>

            {value.size ? (
              <div className="row">
                <h2 className="label">Pace</h2>
                <div className="chips">
                  <button className={!value.speed ? 'chip on' : 'chip'}
                          aria-pressed={!value.speed}
                          onClick={() => set({ speed: undefined })}>Untimed</button>
                  {SPEEDS.map((x) => (
                    <button key={x}
                            className={value.speed === x ? 'chip on' : 'chip'}
                            aria-pressed={value.speed === x}
                            onClick={() => set({ speed: x })}>
                      {x}x
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      {picked ? (
        <div className="startbar">
          <div className="startbar-inner">
            {/* The number stacks over its label so the phone row can be
                count on the left, button on the right, one line. */}
            <span className="count">
              {loading ? 'Counting…' : value.size ? (
                <>
                  <strong>{Math.min(value.size, count).toLocaleString()}</strong>
                  <span className="count-sub">
                    {`of ${count.toLocaleString()}`}
                    {value.speed ? ` · ${formatClock(plannedSeconds)}` : ''}
                  </span>
                </>
              ) : (
                <>
                  <strong>{count.toLocaleString()}</strong>
                  <span className="count-sub">
                    {`question${count === 1 ? '' : 's'} selected`}
                  </span>
                </>
              )}
            </span>
            {totals.live ? (
              <label className="excl">
                <input type="checkbox"
                       checked={value.excludeLive ?? false}
                       onChange={(e) => set({ excludeLive: e.target.checked || undefined })} />
                Exclude active questions
              </label>
            ) : null}
            <button className="btn primary lg" disabled={!count || loading} onClick={onStart}>
              {value.size ? 'Start set' : 'Start practicing'}
              <Icon name="arrow-right" size={18} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
