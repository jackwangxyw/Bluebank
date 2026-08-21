import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from './api'
import { Home } from './components/Home'
import { Stats as StatsPage } from './components/Stats'
import { About } from './components/About'
import { AccountBadge } from './components/Account'
import { Navigator } from './components/Navigator'
import { Notes } from './components/Notes'
import { QuestionView } from './components/QuestionView'
import { Desmos } from './components/Desmos'
import { Icon } from './components/Icon'
import { formatClock, useQuestionTimer } from './lib/useTimer'
import * as sync from './lib/sync'
import type {
  Annotation, Filters, GradeResult, Question, SetItem, Stats, TaxonomyRow,
} from './types'

const SECTION_LABEL = { RW: 'Reading and Writing', MATH: 'Math' } as const

const DIRECTIONS = {
  RW: [
    'The questions in this section address a number of important reading and writing skills. Each question includes one or more passages, which may include a table or graph. Read each passage and question carefully, and then choose the best answer to the question based on the passage(s).',
    'All questions in this section are multiple-choice with four answer choices. Each question has a single best answer.',
  ],
  MATH: [
    'The questions in this section address a number of important math skills. Use of a calculator is permitted for all questions.',
    'For multiple-choice questions, solve each problem and choose the correct answer from the choices provided. For student-produced response questions, solve each problem and enter your answer.',
  ],
} as const

export default function App() {
  const [view, setView] = useState<'home' | 'stats' | 'about' | 'practice'>('home')

  const [taxonomy, setTaxonomy] = useState<TaxonomyRow[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [filters, setFilters] = useState<Filters>({})
  const [items, setItems] = useState<SetItem[]>([])
  const [index, setIndex] = useState(0)
  const [listLoading, setListLoading] = useState(true)

  const [question, setQuestion] = useState<Question | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [flagged, setFlagged] = useState(false)
  const [response, setResponse] = useState<string | null>(null)
  const [result, setResult] = useState<GradeResult | null>(null)
  const [crossOut, setCrossOut] = useState<Set<string>>(new Set())
  // On by default: the cross-out tool is more useful than it is intrusive.
  const [crossOutMode, setCrossOutMode] = useState(true)

  const [showNavigator, setShowNavigator] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [showDirections, setShowDirections] = useState(false)
  const [showTimer, setShowTimer] = useState(true)
  const [showDesmos, setShowDesmos] = useState(false)
  const [desmosSplit, setDesmosSplit] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const current = items[index] ?? null
  const practising = view === 'practice'
  const seconds = useQuestionTimer(
    current?.id ?? null, practising && question !== null && result === null)

  useEffect(() => {
    api.taxonomy()
      .then((d) => { setTaxonomy(d.taxonomy); setStats(d.stats) })
      .catch((e: Error) => setError(e.message))
  }, [])

  // Starts the sync loop if a session already exists. No-op when signed out or
  // when the build has no sync configured, so the localhost path is untouched.
  useEffect(() => { sync.start() }, [])

  useEffect(() => {
    let stale = false
    setListLoading(true)
    api.questionSet(filters)
      .then((d) => { if (!stale) { setItems(d.questions); setIndex(0) } })
      .catch((e: Error) => !stale && setError(e.message))
      .finally(() => { if (!stale) setListLoading(false) })
    return () => { stale = true }
  }, [filters])

  useEffect(() => {
    if (!practising || !current) { setQuestion(null); return }
    let stale = false
    setLoading(true)
    setQuestion(null); setResult(null); setResponse(null)
    setCrossOut(new Set()); setAnnotations([])
    api.question(current.id)
      .then((d) => {
        if (stale) return
        setQuestion(d.question); setAnnotations(d.annotations); setFlagged(d.flagged)
      })
      .catch((e: Error) => !stale && setError(e.message))
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [current?.id, practising])

  const go = useCallback((next: number) => {
    setIndex(Math.min(items.length - 1, Math.max(0, next)))
  }, [items.length])

  async function submit() {
    if (!current || !response || result) return
    try {
      const graded = await api.answer(current.id, response, seconds)
      setResult(graded)
      setItems((prev) => prev.map((item) => (
        item.id === current.id
          ? {
              ...item,
              last_correct: graded.correct ? 1 : 0,
              last_seconds: seconds,
              last_response: response,
              answered_at: Math.floor(Date.now() / 1000),
              attempt_count: (item.attempt_count ?? 0) + 1,
            }
          : item
      )))
      api.stats().then(setStats).catch(() => {})
    } catch (e) { setError((e as Error).message) }
  }

  async function toggleFlag() {
    if (!current) return
    const next = !flagged
    setFlagged(next)
    setItems((prev) => prev.map((i) => (i.id === current.id ? { ...i, flagged: next ? 1 : 0 } : i)))
    try { await api.flag(current.id, next) } catch (e) { setError((e as Error).message) }
  }

  async function persistAnnotations(next: Annotation[]) {
    if (!current) return
    setAnnotations(next)
    try {
      const saved = await api.saveAnnotations(current.id, next)
      setAnnotations(saved.annotations)
    } catch (e) { setError((e as Error).message) }
  }

  function toggleCrossOut(label: string) {
    setCrossOut((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else { next.add(label); if (response === label) setResponse(null) }
      return next
    })
  }

  useEffect(() => {
    if (!practising) return
    function onKey(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (event.key === 'ArrowRight') go(index + 1)
      if (event.key === 'ArrowLeft') go(index - 1)
      if (event.key === 'Escape') {
        setShowNavigator(false); setShowDesmos(false); setShowDirections(false)
        setShowNotes(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, go, practising])

  const section = question?.section ?? filters.section ?? 'RW'
  // Reads like Bluebook's "Section 1, Module 2: Reading and Writing": the
  // section, then whatever the filters narrowed it to.
  const setTitle = useMemo(() => {
    const lead = filters.section ? SECTION_LABEL[filters.section] : 'All questions'
    if (filters.skill && question?.skill_name) return `${lead}: ${question.skill_name}`
    if (filters.domain && question?.domain_name) return `${lead}: ${question.domain_name}`
    return lead
  }, [filters, question?.domain_name, question?.skill_name])

  if (!practising) {
    return (
      <div className="shell">
        {error ? (
          <div className="error" onClick={() => setError(null)}>{error} (dismiss)</div>
        ) : null}
        <nav className="tabs">
          <div className="tabs-inner">
            <span className="wordmark">Bluebank</span>
            <button className={view === 'home' ? 'tab on' : 'tab'}
                    onClick={() => setView('home')}>Practice</button>
            <button className={view === 'stats' ? 'tab on' : 'tab'}
                    onClick={() => setView('stats')}>Stats</button>
            <button className={view === 'about' ? 'tab on' : 'tab'}
                    onClick={() => setView('about')}>About</button>
            {/*
              In the nav rather than in a page corner, so Home, Stats and About
              all show it from one instance. It was on Stats only, and the user's
              report was that nothing indicated sync existed. The practice view
              renders its own header and deliberately does not get one.
            */}
            <AccountBadge />
          </div>
        </nav>

        {view === 'home' ? (
          <Home taxonomy={taxonomy} stats={stats} value={filters} count={items.length}
                loading={listLoading} onChange={setFilters}
                onStart={() => { setIndex(0); setView('practice') }} />
        ) : view === 'about' ? (
          <div className="page">
            <About />
          </div>
        ) : (
          <div className="page">
            <StatsPage taxonomy={taxonomy}
                       onPractice={(next) => {
                         setFilters(next)
                         setIndex(0)
                         setView('practice')
                       }} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <div className="section-title">
            <button className="backbtn" onClick={() => setView('home')} title="Go back">
              <Icon name="chevron-left" size={18} strokeWidth={2.2} />
            </button>
            {setTitle}
          </div>
          <button className="ghostlink" onClick={() => setShowDirections((v) => !v)}>
            Directions
            <Icon name={showDirections ? 'chevron-up' : 'chevron-down'} size={15}
                  strokeWidth={2.2} />
          </button>
        </div>

        <div className="topbar-center">
          <div className={showTimer ? 'clock' : 'clock is-hidden'}>
            {showTimer ? formatClock(seconds) : '···'}
          </div>
          <button className="hide-btn" onClick={() => setShowTimer((v) => !v)}>
            {showTimer ? 'Hide' : 'Show'}
          </button>
        </div>

        <div className="topbar-right">
          {section === 'MATH' ? (
            <button className={showDesmos ? 'tool on' : 'tool'}
                    onClick={() => setShowDesmos((v) => !v)}>
              <span className="tool-glyphs"><Icon name="calculator" size={21} /></span>
              <span>Calculator</span>
            </button>
          ) : null}
          <button className={showNotes ? 'tool on' : 'tool'}
                  onClick={() => setShowNotes((v) => !v)}>
            <span className="tool-glyphs">
              <Icon name="highlighter" size={21} />
              <Icon name="note" size={20} />
            </span>
            <span>
              Highlights &amp; Notes
              {annotations.length ? ` (${annotations.length})` : ''}
            </span>
          </button>
          <div className="tool static">
            <span className="tool-glyphs"><Icon name="check" size={21} /></span>
            <span>
              {stats && stats.attempts
                ? `${stats.correct}/${stats.attempts}`
                : '0/0'}
            </span>
          </div>
        </div>
      </header>

      {error ? (
        <div className="error" onClick={() => setError(null)}>{error} (dismiss)</div>
      ) : null}

      <main className={desmosSplit === null ? 'main' : 'main is-split-tool'}
            style={desmosSplit === null
              ? undefined
              : ({ '--tool-split': `${desmosSplit}%` } as React.CSSProperties)}>
        {loading ? <div className="placeholder">Loading question…</div> : null}
        {!loading && !current ? (
          <div className="placeholder">No questions match these filters.</div>
        ) : null}
        {!loading && question && current ? (
          <QuestionView
            question={question}
            number={index + 1}
            annotations={annotations}
            result={result}
            seconds={seconds}
            response={response}
            flagged={flagged}
            crossOutMode={crossOutMode}
            crossOut={crossOut}
            onRespond={setResponse}
            onSubmit={submit}
            onToggleFlag={toggleFlag}
            onToggleCrossOutMode={() => setCrossOutMode((v) => !v)}
            onToggleCrossOut={toggleCrossOut}
            onAddAnnotation={(a) => persistAnnotations([...annotations, a as Annotation])}
            onRemoveAnnotation={(id) =>
              persistAnnotations(annotations.filter((a) => a.id !== id))}
          />
        ) : null}
        {showDesmos ? (
          <Desmos onClose={() => setShowDesmos(false)}
                  onExpandedChange={setDesmosSplit} />
        ) : null}
      </main>

      <footer className="bottombar">
        <div className="bottom-left">Bluebank</div>
        <div className="bottom-mid">
          <button className="navbtn" onClick={() => setShowNavigator(true)}
                  disabled={!items.length}>
            Question {items.length ? index + 1 : 0} of {items.length.toLocaleString()}
            <Icon name="chevron-up" size={15} strokeWidth={2.2} />
          </button>
        </div>
        <div className="bottom-right">
          <button className="btn primary" onClick={() => go(index - 1)} disabled={index <= 0}>
            Back
          </button>
          <button className="btn primary" onClick={() => go(index + 1)}
                  disabled={index >= items.length - 1}>
            Next
          </button>
        </div>
      </footer>

      {showNavigator ? (
        <Navigator items={items} current={index} title={setTitle}
                   onGo={go} onClose={() => setShowNavigator(false)} />
      ) : null}

      {showNotes ? (
        <Notes annotations={annotations}
               onRemove={(id) => persistAnnotations(annotations.filter((a) => a.id !== id))}
               onClose={() => setShowNotes(false)} />
      ) : null}

      {showDirections ? (
        <>
          <div className="dir-scrim" onClick={() => setShowDirections(false)} />
          <div className="dir-sheet" role="dialog" aria-label="Directions">
            <div className="dir-body">
              {DIRECTIONS[section].map((line) => <p key={line}>{line}</p>)}
            </div>
            <div className="dir-foot">
              <button className="btn primary" onClick={() => setShowDirections(false)}>
                Close
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
