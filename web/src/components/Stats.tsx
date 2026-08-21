import { Fragment, useMemo } from 'react'
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

    const biggestDomain = Math.max(1, ...domainList.map((d) => d.n))

    return {
      overall, sections, domainList, skillList, difficulty, focus, untouched,
      biggestDomain,
    }
  }, [taxonomy])

  const {
    overall, sections, domainList, skillList, difficulty,
    focus, untouched, biggestDomain,
  } = model

  const skillsFor = (section: Section, domain: string) =>
    skillList.filter((k) => k.section === section && k.domain === domain)


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
                        onClick={() => onPractice({ section: k.section, domains: [k.domain], skills: [k.code] })}>
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
                          onClick={() => onPractice({ section: k.section, domains: [k.domain], skills: [k.code] })}>
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
        </div>
        <ul className="dbars">
          {domainList.map((d, i) => (
            <Fragment key={d.section + d.code}>
              {i === 0 || domainList[i - 1].section !== d.section ? (
                <li className="dbar-group">{SECTION_NAME[d.section]}</li>
              ) : null}
            <li className="dbar">
              <span className="dbar-name" title={d.name}>{d.name}</span>
              <span className="dbar-track" title={`${d.seen} of ${d.n} attempted`}>
                <span className="dbar-total" style={{ width: `${(d.n / biggestDomain) * 100}%` }}>
                  <span className="dbar-seen"
                        style={{ width: `${Math.max(pct(d.seen, d.n), d.seen ? 1.5 : 0)}%` }} />
                </span>
              </span>
              <span className="dbar-n">{d.n.toLocaleString()}</span>
              <Accuracy t={d} />
            </li>
            </Fragment>
          ))}
        </ul>
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
                                onClick={() => onPractice({ section, domains: [d.code], skills: [k.code] })}
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
