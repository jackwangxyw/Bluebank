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

const DIFFICULTY_NAME: Record<string, string> = { E: 'Easy', M: 'Medium', H: 'Hard' }

interface Tally {
  n: number
  seen: number
  correct: number
}

const empty = (): Tally => ({ n: 0, seen: 0, correct: 0 })

function add(into: Tally, row: TaxonomyRow) {
  into.n += row.n
  into.seen += row.seen
  into.correct += row.correct
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

/** Accuracy colour, using the same three the navigator already uses. */
function grade(accuracy: number): string {
  if (accuracy >= 80) return 'good'
  if (accuracy >= 60) return 'mid'
  return 'poor'
}

function Bar({ value, total, tone }: { value: number; total: number; tone?: string }) {
  return (
    <span className={tone ? `bar bar-${tone}` : 'bar'}>
      <span className="bar-fill" style={{ width: `${Math.min(100, pct(value, total))}%` }} />
    </span>
  )
}

function Accuracy({ t }: { t: Tally }) {
  if (!t.seen) return <span className="acc none">—</span>
  const value = pct(t.correct, t.seen)
  return <span className={`acc ${grade(value)}`}>{value}%</span>
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
      add(s, row)
      sections.set(row.section, s)

      const dKey = row.section + '|' + row.domain
      const d = domains.get(dKey)
        ?? { ...empty(), name: row.domain_name, section: row.section, code: row.domain }
      add(d, row)
      domains.set(dKey, d)

      const kKey = dKey + '|' + row.skill
      const k = skills.get(kKey) ?? {
        ...empty(),
        name: row.skill_name, code: row.skill,
        domain: row.domain, domainName: row.domain_name, section: row.section,
      }
      add(k, row)
      skills.set(kKey, k)

      const f = difficulty.get(row.difficulty) ?? empty()
      add(f, row)
      difficulty.set(row.difficulty, f)
    }

    const order: Record<Section, number> = { RW: 0, MATH: 1 }
    const domainList = [...domains.values()].sort(
      (a, b) => order[a.section] - order[b.section] || a.name.localeCompare(b.name))
    const skillList = [...skills.values()]

    // Weakest first, but only skills with enough attempts to mean anything.
    const focus = skillList
      .filter((k) => k.seen >= MIN_FOR_ADVICE)
      .sort((a, b) => pct(a.correct, a.seen) - pct(b.correct, b.seen))
      .slice(0, 5)

    // Nothing attempted enough yet? Then the useful advice is what you have
    // not touched at all, biggest first.
    const untouched = skillList
      .filter((k) => k.seen === 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 5)

    return { overall, sections, domainList, skillList, difficulty, focus, untouched }
  }, [taxonomy])

  const { overall, sections, domainList, skillList, difficulty, focus, untouched } = model
  const skillsFor = (section: Section, domain: string) =>
    skillList.filter((k) => k.section === section && k.domain === domain)

  return (
    <div className="stats">
      <section className="summary">
        <div className="summary-fig">
          <span className="summary-n">{overall.seen.toLocaleString()}</span>
          <span className="summary-l">Questions attempted</span>
        </div>
        <div className="summary-fig">
          <span className="summary-n">
            {overall.seen ? `${pct(overall.correct, overall.seen)}%` : '—'}
          </span>
          <span className="summary-l">Overall accuracy</span>
        </div>
        <div className="summary-fig">
          <span className="summary-n">{(overall.n - overall.seen).toLocaleString()}</span>
          <span className="summary-l">Never seen</span>
        </div>
        <div className="summary-meter">
          <div className="summary-meter-head">
            <span className="label">Bank covered</span>
            <span className="summary-meter-n">
              {overall.seen.toLocaleString()}
              <span className="dim"> / {overall.n.toLocaleString()}</span>
            </span>
          </div>
          <Bar value={overall.seen} total={overall.n} />
        </div>
      </section>

      <section className="block">
        <h2 className="label">Where to focus</h2>
        {focus.length ? (
          <ul className="focus">
            {focus.map((k) => (
              <li key={k.section + k.domain + k.code} className="focus-row">
                <div className="focus-id">
                  <span className="focus-name">{k.name}</span>
                  <span className="focus-where">{k.domainName}</span>
                </div>
                <span className="focus-seen">{k.correct}/{k.seen} right</span>
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
              Nothing has {MIN_FOR_ADVICE} attempts yet, so there is no reliable
              weak spot to point at. These are the biggest areas you have not
              touched at all.
            </p>
            <ul className="focus">
              {untouched.map((k) => (
                <li key={k.section + k.domain + k.code} className="focus-row">
                  <div className="focus-id">
                    <span className="focus-name">{k.name}</span>
                    <span className="focus-where">{k.domainName}</span>
                  </div>
                  <span className="focus-seen">{k.n.toLocaleString()} unseen</span>
                  <span className="acc none">—</span>
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

      <section className="block">
        <h2 className="label">By difficulty</h2>
        <ul className="rows">
          {['E', 'M', 'H'].map((key) => {
            const t = difficulty.get(key) ?? empty()
            return (
              <li key={key} className="row-item">
                <span className="row-name">{DIFFICULTY_NAME[key]}</span>
                <span className="row-count">{t.seen}<span className="dim"> / {t.n.toLocaleString()}</span></span>
                <Bar value={t.seen} total={t.n} />
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
              <h2 className="label">{SECTION_NAME[section]}</h2>
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
                    <Bar value={d.seen} total={d.n} />
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
                        <Bar value={k.seen} total={k.n} />
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
