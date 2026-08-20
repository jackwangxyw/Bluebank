import { useMemo } from 'react'
import { Icon } from './Icon'
import type { Filters, Section, TaxonomyRow } from '../types'

interface Props {
  taxonomy: TaxonomyRow[]
  onPractice: (filters: Filters) => void
}

/**
 * How many attempts a skill needs before its accuracy is worth acting on.
 * Below this the number is shown but never used to rank what to work on --
 * one unlucky question should not become "your weakest skill".
 */
const MIN_FOR_ADVICE = 5

const SECTION_NAME: Record<Section, string> = {
  RW: 'Reading and Writing',
  MATH: 'Math',
}

const DIFFICULTIES = [
  { key: 'E', label: 'Easy' },
  { key: 'M', label: 'Medium' },
  { key: 'H', label: 'Hard' },
] as const

/**
 * Sequential ramp, one hue, light to dark, derived from College Board's
 * #324DC7 rather than the reference palette's stock blue.
 *
 * Validated with the data-viz validator: lightness is monotone, every adjacent
 * step clears the 0.06 lightness gap, hue spread is 4 degrees. The palest steps
 * sit below 3:1 against white on purpose -- this is a *sequential* scale where
 * "near zero" is meant to recede toward the surface -- so every cell carries a
 * visible count label, which is the relief the low-contrast steps require.
 */
const RAMP = ['#e8ecfb', '#ccd5f5', '#a9b8ee', '#8098e4', '#4f68d5', '#324dc7', '#23379a']

/**
 * The step at which a cell label must flip to white.
 *
 * Computed, not guessed: measured against #1e1e1e and #ffffff, every step below
 * this clears 4.5:1 with dark text and every step from here clears it with
 * white. The original step 4 (#5872da) managed neither -- 3.84 dark, 4.34 white
 * -- so no label on it could have been legible. It was re-stepped to #4f68d5,
 * and the ramp re-validated: still monotone, still a single hue, gaps intact.
 */
const RAMP_INVERT_FROM = 4

interface Tally { n: number; seen: number; correct: number }
const empty = (): Tally => ({ n: 0, seen: 0, correct: 0 })
const add = (into: Tally, row: TaxonomyRow) => {
  into.n += row.n; into.seen += row.seen; into.correct += row.correct
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

/** Accuracy band. Text colours, so all three clear 4.5:1 on white. */
function grade(accuracy: number): string {
  if (accuracy >= 80) return 'good'
  if (accuracy >= 60) return 'mid'
  return 'poor'
}

function Accuracy({ t }: { t: Tally }) {
  if (!t.seen) return <span className="acc none" title="Not attempted yet">—</span>
  const value = pct(t.correct, t.seen)
  return (
    <span className={`acc ${grade(value)}`} title={`${t.correct} of ${t.seen} correct`}>
      {value}%
    </span>
  )
}

/** Single-series magnitude bar. No legend: the row label names it. */
function Bar({ value, total, title }: { value: number; total: number; title?: string }) {
  return (
    <span className="bar" title={title}>
      <span className="bar-fill" style={{ width: `${Math.max(Math.min(100, pct(value, total)), value ? 1.5 : 0)}%` }} />
    </span>
  )
}

export function Stats({ taxonomy, onPractice }: Props) {
  const model = useMemo(() => {
    const overall = empty()
    const sections = new Map<Section, Tally>()
    const domains = new Map<string, Tally & { name: string; section: Section; code: string }>()
    const skills = new Map<string, Tally & {
      name: string; code: string; domain: string; domainName: string; section: Section
    }>()
    const difficulty = new Map<string, Tally>()
    // domain code -> difficulty -> tally, for the composition heatmap
    const grid = new Map<string, Map<string, Tally>>()

    for (const row of taxonomy) {
      add(overall, row)

      const s = sections.get(row.section) ?? empty()
      add(s, row); sections.set(row.section, s)

      const dKey = row.section + '|' + row.domain
      const d = domains.get(dKey)
        ?? { ...empty(), name: row.domain_name, section: row.section, code: row.domain }
      add(d, row); domains.set(dKey, d)

      const kKey = dKey + '|' + row.skill
      const k = skills.get(kKey) ?? {
        ...empty(), name: row.skill_name, code: row.skill,
        domain: row.domain, domainName: row.domain_name, section: row.section,
      }
      add(k, row); skills.set(kKey, k)

      const f = difficulty.get(row.difficulty) ?? empty()
      add(f, row); difficulty.set(row.difficulty, f)

      const g = grid.get(dKey) ?? new Map<string, Tally>()
      const cell = g.get(row.difficulty) ?? empty()
      add(cell, row); g.set(row.difficulty, cell); grid.set(dKey, g)
    }

    const order: Record<Section, number> = { RW: 0, MATH: 1 }
    const domainList = [...domains.values()].sort(
      (a, b) => order[a.section] - order[b.section] || a.name.localeCompare(b.name))
    const skillList = [...skills.values()]

    const focus = skillList
      .filter((k) => k.seen >= MIN_FOR_ADVICE)
      .sort((a, b) => pct(a.correct, a.seen) - pct(b.correct, b.seen))
      .slice(0, 5)

    const untouched = skillList
      .filter((k) => k.seen === 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 5)

    const gridMax = Math.max(
      1, ...[...grid.values()].flatMap((g) => [...g.values()].map((c) => c.n)))
    const biggestDomain = Math.max(1, ...domainList.map((d) => d.n))

    return {
      overall, sections, domainList, skillList, difficulty, focus, untouched,
      grid, gridMax, biggestDomain,
    }
  }, [taxonomy])

  const {
    overall, sections, domainList, skillList, difficulty,
    focus, untouched, grid, gridMax, biggestDomain,
  } = model

  const skillsFor = (section: Section, domain: string) =>
    skillList.filter((k) => k.section === section && k.domain === domain)

  /** Snap a count onto the sequential ramp, returning the step index. */
  const rampIndex = (n: number) =>
    Math.min(RAMP.length - 1, Math.round((n / gridMax) * (RAMP.length - 1)))

  const accuracy = overall.seen ? pct(overall.correct, overall.seen) : null
  const coverage = pct(overall.seen, overall.n)

  return (
    <div className="stats">
      {/* Single headlines are stat tiles, not charts. */}
      <section className="hero-stats">
        <div className="tile tile-lead">
          <span className="tile-l">Overall accuracy</span>
          <span className={`tile-n ${accuracy === null ? 'none' : grade(accuracy)}`}>
            {accuracy === null ? '—' : `${accuracy}%`}
          </span>
          <span className="tile-sub">
            {overall.correct.toLocaleString()} of {overall.seen.toLocaleString()} right
          </span>
        </div>
        <div className="tile">
          <span className="tile-l">Attempted</span>
          <span className="tile-n">{overall.seen.toLocaleString()}</span>
          <span className="tile-sub">
            {overall.seen && coverage < 1 ? '<1' : coverage}% of the bank
          </span>
        </div>
        <div className="tile">
          <span className="tile-l">Never seen</span>
          <span className="tile-n">{(overall.n - overall.seen).toLocaleString()}</span>
          <span className="tile-sub">of {overall.n.toLocaleString()} total</span>
        </div>
        <div className="tile tile-wide">
          <span className="tile-l">Bank covered</span>
          <span className="meter big">
            <span className="meter-fill" style={{ width: `${Math.max(coverage, 0.4)}%` }} />
          </span>
          <span className="tile-sub">
            {overall.seen.toLocaleString()} of {overall.n.toLocaleString()} questions
          </span>
        </div>
      </section>

      <section className="block">
        <div className="block-head">
          <h2 className="h">Where to focus</h2>
        </div>
        {focus.length ? (
          <ul className="focus">
            {focus.map((k) => (
              <li key={k.section + k.domain + k.code} className="focus-row">
                <div className="focus-id">
                  <span className="focus-name">{k.name}</span>
                  <span className="focus-where">{k.domainName}</span>
                </div>
                <Bar value={k.correct} total={k.seen}
                     title={`${k.correct} of ${k.seen} correct`} />
                <Accuracy t={k} />
                <button className="btn small"
                        onClick={() => onPractice({ section: k.section, domain: k.domain, skill: k.code })}>
                  Practice
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="hint">
              Nothing has {MIN_FOR_ADVICE} attempts yet, so there is no reliable weak
              spot to point at. These are the biggest areas you have not touched.
            </p>
            <ul className="focus">
              {untouched.map((k) => (
                <li key={k.section + k.domain + k.code} className="focus-row">
                  <div className="focus-id">
                    <span className="focus-name">{k.name}</span>
                    <span className="focus-where">{k.domainName}</span>
                  </div>
                  <Bar value={0} total={k.n} title={`${k.n} unseen`} />
                  <span className="acc none">{k.n.toLocaleString()}</span>
                  <button className="btn small"
                          onClick={() => onPractice({ section: k.section, domain: k.domain, skill: k.code })}>
                    Practice
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* Magnitude across categories -> horizontal bars, one series, so the row
          label carries identity and no legend is needed. */}
      <section className="block">
        <div className="block-head">
          <h2 className="h">Questions by domain</h2>
          <span className="block-meta">bar length is bank size · fill is what you have seen</span>
        </div>
        <ul className="dbars">
          {domainList.map((d) => (
            <li key={d.section + d.code} className="dbar">
              <span className="dbar-name">{d.name}</span>
              <span className="dbar-track" title={`${d.seen} of ${d.n} attempted`}>
                <span className="dbar-total" style={{ width: `${(d.n / biggestDomain) * 100}%` }}>
                  <span className="dbar-seen"
                        style={{ width: `${Math.max(pct(d.seen, d.n), d.seen ? 1.5 : 0)}%` }} />
                </span>
              </span>
              <span className="dbar-n">{d.n.toLocaleString()}</span>
              <Accuracy t={d} />
            </li>
          ))}
        </ul>
      </section>

      {/* Continuous magnitude across two dimensions -> sequential heatmap. Every
          cell is labelled, which is also the relief the pale steps require. */}
      <section className="block">
        <div className="block-head">
          <h2 className="h">Bank composition</h2>
          <span className="block-meta">questions per domain and difficulty</span>
        </div>
        <div className="heat">
          <div className="heat-row heat-head">
            <span className="heat-name" />
            {DIFFICULTIES.map((f) => <span key={f.key} className="heat-col">{f.label}</span>)}
            <span className="heat-col">Total</span>
          </div>
          {domainList.map((d) => {
            const g = grid.get(d.section + '|' + d.code)
            return (
              <div key={d.section + d.code} className="heat-row">
                <span className="heat-name" title={d.name}>{d.name}</span>
                {DIFFICULTIES.map((f) => {
                  const cell = g?.get(f.key) ?? empty()
                  const step = rampIndex(cell.n)
                  return (
                    <span key={f.key}
                          className={step >= RAMP_INVERT_FROM ? 'heat-cell on-dark' : 'heat-cell'}
                          style={{ background: RAMP[step] }}
                          title={`${d.name} · ${f.label}: ${cell.n} questions, ${cell.seen} attempted`}>
                      {cell.n.toLocaleString()}
                    </span>
                  )
                })}
                <span className="heat-cell heat-total">{d.n.toLocaleString()}</span>
              </div>
            )
          })}
        </div>
        <div className="heat-legend">
          <span className="heat-legend-l">Fewer</span>
          {RAMP.map((c) => <span key={c} className="heat-swatch" style={{ background: c }} />)}
          <span className="heat-legend-l">More</span>
        </div>
      </section>

      <section className="block">
        <div className="block-head">
          <h2 className="h">By difficulty</h2>
        </div>
        <ul className="dbars">
          {DIFFICULTIES.map((f) => {
            const t = difficulty.get(f.key) ?? empty()
            return (
              <li key={f.key} className="dbar">
                <span className="dbar-name">{f.label}</span>
                <span className="dbar-track" title={`${t.seen} of ${t.n} attempted`}>
                  <span className="dbar-total" style={{ width: '100%' }}>
                    <span className="dbar-seen"
                          style={{ width: `${Math.max(pct(t.seen, t.n), t.seen ? 1.5 : 0)}%` }} />
                  </span>
                </span>
                <span className="dbar-n">{t.n.toLocaleString()}</span>
                <Accuracy t={t} />
              </li>
            )
          })}
        </ul>
      </section>

      {(['RW', 'MATH'] as Section[]).map((section) => {
        const t = sections.get(section) ?? empty()
        return (
          <section className="block" key={section}>
            <div className="block-head">
              <h2 className="h">{SECTION_NAME[section]}</h2>
              <span className="block-meta">
                {t.seen.toLocaleString()} of {t.n.toLocaleString()} attempted
              </span>
              <Accuracy t={t} />
            </div>
            <ul className="rows">
              {domainList.filter((d) => d.section === section).map((d) => (
                <li key={d.code} className="domain-group">
                  <div className="row-item is-domain">
                    <span className="row-name">{d.name}</span>
                    <span className="row-count">{d.seen}<span className="dim"> / {d.n.toLocaleString()}</span></span>
                    <Bar value={d.seen} total={d.n} title={`${d.seen} of ${d.n} attempted`} />
                    <Accuracy t={d} />
                  </div>
                  <ul className="rows sub">
                    {skillsFor(section, d.code).map((k) => (
                      <li key={k.code} className="row-item is-skill">
                        <button className="row-name link"
                                onClick={() => onPractice({ section, domain: d.code, skill: k.code })}
                                title={`Practice ${k.name}`}>
                          {k.name}
                          <Icon name="arrow-right" size={13} strokeWidth={2.2} />
                        </button>
                        <span className="row-count">{k.seen}<span className="dim"> / {k.n.toLocaleString()}</span></span>
                        <Bar value={k.seen} total={k.n} title={`${k.seen} of ${k.n} attempted`} />
                        <Accuracy t={k} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
