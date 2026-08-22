import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from './api'
import { Home } from './components/Home'
import { Stats as StatsPage } from './components/Stats'
import { About } from './components/About'
import { AccountBadge } from './components/Account'
import { GithubLink } from './components/Github'
import { Navigator } from './components/Navigator'
import { Notes } from './components/Notes'
import { MistakeLog } from './components/MistakeLog'
import { Review } from './components/Review'
import { QuestionView } from './components/QuestionView'
import { Desmos } from './components/Desmos'
import { Icon } from './components/Icon'
import { Mark } from './components/Mark'
import { SetResults } from './components/SetResults'
import type { CellState } from './components/Navigator'
import { SetReview } from './components/SetReview'
import { sample } from './lib/draw'
import { setSeconds, formatClock as formatCountdown } from './lib/pacing'
import { formatClock, useQuestionTimer } from './lib/useTimer'
import * as sync from './lib/sync'
import type {
  Annotation, Filters, GradeResult, Mistake, PracticeSet, Question, SetAnswer,
  SetItem, Stats, TaxonomyRow,
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
  const [view, setView] =
    useState<'home' | 'stats' | 'about' | 'review' | 'practice' | 'results'>('home')

  /** Bumped by a sync that pulled rows; drives the taxonomy refetch below. */
  const [dataVersion, setDataVersion] = useState(0)

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

  /**
   * The set being worked through, if this is a set rather than open practice.
   *
   * Its `items` are the frozen question list AND the progress against them, so
   * everything about a set (which questions, in what order, how far in) lives
   * in this one row and survives a reload or a second device.
   */
  const [activeSet, setActiveSet] = useState<PracticeSet | null>(null)
  /**
   * The same set, readable synchronously.
   *
   * Answering twice in quick succession used to lose the first answer: both
   * handlers closed over the `activeSet` of their own render, so the second one
   * rebuilt `items` from a copy that did not have the first answer in it yet.
   * Every write goes through this ref so it always starts from the latest.
   */
  const activeSetRef = useRef<PracticeSet | null>(null)
  const [activeSets, setActiveSets] = useState<PracticeSet[]>([])
  /** The finished set being read back on the results screen. */
  const [shownSet, setShownSet] = useState<PracticeSet | null>(null)
  const [showSetReview, setShowSetReview] = useState(false)
  /** Seconds left on the set clock. Null when the set is untimed. */
  const [remaining, setRemaining] = useState<number | null>(null)

  useEffect(() => { activeSetRef.current = activeSet }, [activeSet])

  const [showNavigator, setShowNavigator] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [showMistake, setShowMistake] = useState(false)
  const [mistake, setMistake] = useState<Mistake | null>(null)
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

  /**
   * Re-read the taxonomy whenever you land back on Home or Stats, and whenever
   * a sync pulls something new.
   *
   * This used to run once on mount. Answering a question updates the stores but
   * nothing told React, so "Bank covered", the per-card progress and the whole
   * Stats page kept showing the numbers from page load until you reloaded.
   * Practice is excluded because the numbers are not on screen there and the
   * set list would refetch under you mid-question.
   */
  useEffect(() => {
    if (view === 'practice') return
    let stale = false
    api.taxonomy()
      .then((d) => { if (!stale) { setTaxonomy(d.taxonomy); setStats(d.stats) } })
      .catch((e: Error) => !stale && setError(e.message))
    return () => { stale = true }
  }, [view, dataVersion])

  // Starts the sync loop if a session already exists. No-op when signed out or
  // when the build has no sync configured, so the localhost path is untouched.
  useEffect(() => { sync.start() }, [])

  /**
   * Open one question on its own, from Review. The set becomes just that
   * question, so Back and Next have nowhere to wander and the navigator says
   * 1 of 1.
   */
  const practiceOne = useCallback((id: string) => {
    const found = items.find((i) => i.id === id)
    if (found) { setItems([found]); setIndex(0); setView('practice'); return }
    api.questionSet({}).then((d) => {
      const one = d.questions.find((q) => q.id === id)
      if (one) { setItems([one]); setIndex(0); setView('practice') }
    }).catch((e: Error) => setError(e.message))
  }, [items])

  // A pull from another device changes the same numbers an answer does.
  useEffect(() => sync.subscribe(() => setDataVersion(sync.getDataVersion())), [])

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
    setShowMistake(false)
    let stale = false
    setLoading(true)
    setQuestion(null); setResult(null); setResponse(null)
    setCrossOut(new Set()); setAnnotations([])
    api.question(current.id)
      .then((d) => {
        if (stale) return
        setQuestion(d.question); setAnnotations(d.annotations); setFlagged(d.flagged)
        setMistake(d.mistake)
      })
      .catch((e: Error) => !stale && setError(e.message))
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [current?.id, practising])

  /** Reload the queue of unfinished sets shown on Home. */
  const refreshActiveSets = useCallback(() => {
    api.listSets(true).then(setActiveSets).catch(() => {})
  }, [])

  useEffect(() => {
    if (view === 'home') refreshActiveSets()
  }, [view, dataVersion, refreshActiveSets])

  /**
   * Turn the loaded pool into a set: draw `size` at random, freeze them, and
   * start working through them.
   *
   * The draw happens here rather than in a backend because both backends hand
   * the whole pool over anyway, and doing it once on the client is what keeps
   * the two identical.
   */
  const startSet = useCallback(async () => {
    if (!filters.size) { setIndex(0); setView('practice'); return }
    try {
      const chosen = sample(items, filters.size)
      const created = await api.saveSet({
        id: crypto.randomUUID(),
        created_at: Math.floor(Date.now() / 1000),
        finished_at: null,
        seconds: 0,
        filters,
        items: chosen.map((q) => ({
          question_id: q.id, response: null, correct: 0, seconds: 0,
        })),
      })
      setActiveSet(created)
      setItems(chosen)
      setIndex(0)
      setView('practice')
    } catch (e) { setError((e as Error).message) }
  }, [filters, items])

  /** Put a set's frozen questions back on screen, at the first unanswered one. */
  const openSet = useCallback(async (id: string) => {
    try {
      const set = await api.getSet(id)
      const pool = await api.questionSet({})
      const byId = new Map(pool.questions.map((q) => [q.id, q]))
      // Order comes from the set, not the pool: that is what makes it the same
      // set every time. A question retired since it was drawn simply drops out.
      const ordered = (set.items ?? [])
        .map((i) => byId.get(i.question_id))
        .filter((q): q is SetItem => Boolean(q))
      const firstOpen = (set.items ?? []).findIndex((i) => i.response === null)
      setActiveSet(set)
      setItems(ordered)
      setIndex(firstOpen < 0 ? 0 : Math.min(firstOpen, ordered.length - 1))
      setView('practice')
    } catch (e) { setError((e as Error).message) }
  }, [])

  /**
   * Drop a set for good, from either list.
   *
   * Deleting the set does not touch the attempts it produced: those are your
   * practice history and belong to the questions, not to the set.
   */
  const dropSet = useCallback(async (id: string) => {
    try {
      await api.deleteSet(id)
      if (activeSet?.id === id) setActiveSet(null)
      if (shownSet?.id === id) { setShownSet(null); setView('review') }
      refreshActiveSets()
    } catch (e) { setError((e as Error).message) }
  }, [refreshActiveSets, activeSet?.id, shownSet?.id])

  const abandonSet = dropSet

  /** Write the set's progress back. Called after every answer. */
  const persistSet = useCallback(async (
    next: SetAnswer[], finished: boolean, spent: number,
  ) => {
    const live = activeSetRef.current
    if (!live) return null
    try {
      const saved = await api.saveSet({
        id: live.id,
        created_at: live.created_at,
        finished_at: finished ? Math.floor(Date.now() / 1000) : null,
        seconds: spent,
        filters: live.filters,
        items: next,
      })
      // Only the finish path writes back. Adopting the server's row after a
      // progress write would undo any answer given while the request was in
      // flight, which is exactly what the HTTP backend's round trip makes easy.
      // The local ref is authoritative for the length of the session.
      if (finished) { activeSetRef.current = null; setActiveSet(null) }
      return saved
    } catch (e) { setError((e as Error).message); return null }
  }, [])

  /** End the set and show the score. */
  const finishSet = useCallback(async () => {
    const live = activeSetRef.current
    if (!live) return
    const spent = live.seconds ?? 0
    const saved = await persistSet(live.items ?? [], true, spent)
    setShowSetReview(false)
    setShownSet(saved)
    setRemaining(null)
    setView('results')
    refreshActiveSets()
    api.taxonomy().then((d) => { setTaxonomy(d.taxonomy); setStats(d.stats) }).catch(() => {})
  }, [persistSet, refreshActiveSets])

  /**
   * The set clock.
   *
   * Priced per question from the real test's own pace and started when the set
   * is opened, not when it was created, so closing the tab does not run it
   * down. Running out ends the set exactly as finishing it does, which is what
   * the real thing does at the end of a module.
   */
  useEffect(() => {
    if (!practising || !activeSet?.filters?.speed) { setRemaining(null); return }
    const sections = items.map((i) => i.section)
    const total = setSeconds(sections, activeSet.filters.speed)
    const left = Math.max(0, total - (activeSet.seconds ?? 0))
    setRemaining(left)
    if (!left) return
    const started = Date.now()
    const tick = setInterval(() => {
      const now = Math.max(0, left - Math.floor((Date.now() - started) / 1000))
      setRemaining(now)
      if (now <= 0) clearInterval(tick)
    }, 1000)
    return () => clearInterval(tick)
    // activeSet.id rather than activeSet: re-running this on every answer would
    // restart the clock from the top each time.
  }, [practising, activeSet?.id, activeSet?.filters?.speed, items])

  useEffect(() => {
    if (remaining === 0 && activeSet) void finishSet()
  }, [remaining, activeSet, finishSet])

  /** Open a finished set's score screen from the review page. */
  const showSet = useCallback(async (id: string) => {
    try {
      setShownSet(await api.getSet(id))
      setView('results')
    } catch (e) { setError((e as Error).message) }
  }, [])

  /**
   * Run the same questions again as a NEW set, rather than resetting the old
   * one. The score you already have is history and has to stay put.
   */
  const redoSet = useCallback(async (old: PracticeSet) => {
    try {
      const full = old.items ? old : await api.getSet(old.id)
      const created = await api.saveSet({
        id: crypto.randomUUID(),
        created_at: Math.floor(Date.now() / 1000),
        finished_at: null,
        seconds: 0,
        filters: full.filters,
        items: (full.items ?? []).map((i) => ({
          question_id: i.question_id, response: null, correct: 0 as const, seconds: 0,
        })),
      })
      setShownSet(null)
      await openSet(created.id)
    } catch (e) { setError((e as Error).message) }
  }, [])

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

      // A set keeps its own copy of what happened, so its score is fixed on the
      // day rather than re-derived from attempts you might repeat later.
      const live = activeSetRef.current
      if (live) {
        const next = (live.items ?? []).map((i) => (
          i.question_id === current.id
            ? { ...i, response, correct: (graded.correct ? 1 : 0) as 0 | 1, seconds }
            : i
        ))
        const spent = (live.seconds ?? 0) + seconds
        // Update the ref first so an answer landing before the write returns
        // still builds on this one.
        activeSetRef.current = { ...live, items: next, seconds: spent }
        setActiveSet(activeSetRef.current)
        void persistSet(next, false, spent)
      }
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

  /**
   * How THIS set is going, cell by cell.
   *
   * Not the same as each question's own history: redo a set and every question
   * in it has been answered before, so the navigator would show a full grid of
   * greens before you had answered anything. A set is one pass, so there is no
   * retry state within it.
   */
  const setStates = useMemo<CellState[] | undefined>(() => {
    if (!activeSet?.items) return undefined
    const byId = new Map(activeSet.items.map((i) => [i.question_id, i]))
    return items.map((item) => {
      const row = byId.get(item.id)
      if (!row || row.response === null || row.response === '') return 'unanswered'
      return row.correct ? 'first' : 'wrong'
    })
  }, [activeSet?.items, items])

  /** Nothing left unanswered in this set. */
  const setComplete = Boolean(
    activeSet && setStates?.length && setStates.every((st) => st !== 'unanswered'),
  )

  const section = question?.section ?? filters.section ?? 'RW'
  // Reads like Bluebook's "Section 1, Module 2: Reading and Writing": the
  // section, then whatever the filters narrowed it to.
  const setTitle = useMemo(() => {
    // A set describes itself from the filters it was BUILT with. Reading the
    // live filter state instead made a resumed set announce whatever the home
    // page happened to be showing.
    const f = activeSet?.filters ?? filters
    const lead = f.section ? SECTION_LABEL[f.section] : 'All questions'
    if (f.skills?.length === 1 && question?.skill_name) {
      return `${lead}: ${question.skill_name}`
    }
    if (f.domains?.length === 1 && question?.domain_name) {
      return `${lead}: ${question.domain_name}`
    }
    return lead
  }, [activeSet?.filters, filters, question?.domain_name, question?.skill_name])

  if (!practising) {
    return (
      <div className="shell">
        {error ? (
          <div className="error" onClick={() => setError(null)}>{error} (dismiss)</div>
        ) : null}
        <nav className="tabs">
          <div className="tabs-inner">
            <span className="brand">
              <Mark />
              <span className="wordmark">Bluebank</span>
            </span>
            <button className={view === 'home' ? 'tab on' : 'tab'}
                    onClick={() => setView('home')}>Practice</button>
            <button className={view === 'review' ? 'tab on' : 'tab'}
                    onClick={() => setView('review')}>Review</button>
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
            <GithubLink />
            <AccountBadge />
          </div>
        </nav>

        {view === 'home' ? (
          <Home taxonomy={taxonomy} stats={stats} value={filters} count={items.length}
                loading={listLoading} onChange={setFilters}
                activeSets={activeSets}
                onResume={openSet}
                onAbandon={abandonSet}
                onStart={startSet} />
        ) : view === 'about' ? (
          <div className="page">
            <About />
          </div>
        ) : view === 'results' ? (
          <div className="page">
            {shownSet ? (
              <SetResults set={shownSet}
                          onPractice={practiceOne}
                          onRedo={redoSet}
                          onDelete={dropSet}
                          onDone={() => { setShownSet(null); setView('review') }} />
            ) : null}
          </div>
        ) : view === 'review' ? (
          <div className="page">
            <Review onPractice={practiceOne} onOpenSet={showSet}
                    onDeleteSet={dropSet} />
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
            {/* Wrapped so it can be truncated on a phone. A bare text node in a
                flex row cannot take text-overflow. */}
            <span className="section-name">{setTitle}</span>
          </div>
          <button className="ghostlink" onClick={() => setShowDirections((v) => !v)}>
            Directions
            <Icon name={showDirections ? 'chevron-up' : 'chevron-down'} size={15}
                  strokeWidth={2.2} />
          </button>
        </div>

        <div className="topbar-center">
          {/* A timed set counts the whole set down, the way a module does on the
              day. Untimed practice keeps the per-question stopwatch it had. */}
          <div className={
            (showTimer ? 'clock' : 'clock is-hidden')
            + (remaining !== null && remaining <= 60 ? ' is-low' : '')
          }>
            {!showTimer ? '···'
              : remaining !== null ? formatCountdown(remaining)
                : formatClock(seconds)}
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
            {/* `has-count` so a phone can drop the label AND the wrapper when
                there is nothing left inside it. Hiding only the words leaves an
                empty flex item that still eats the row gap, which pushed the
                glyphs half a pixel off the bar's centre. */}
            <span className={annotations.length ? 'tool-label has-count' : 'tool-label'}>
              <span className="tool-text">Highlights &amp; Notes</span>
              {annotations.length ? ` (${annotations.length})` : ''}
            </span>
          </button>
          <button className={showMistake ? 'tool on' : 'tool'}
                  onClick={() => setShowMistake((v) => !v)}>
            <span className="tool-glyphs"><Icon name="tag" size={20} /></span>
            <span className={mistake ? 'tool-label has-count' : 'tool-label'}>
              <span className="tool-text">Mistake log</span>
              {mistake ? ` (${mistake.tags.length || 1})` : ''}
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
          {activeSet ? (
            <button className={setComplete ? 'btn primary' : 'btn'}
                    onClick={() => setShowSetReview(true)}>
              Review
              <Icon name="arrow-right" size={17} strokeWidth={2.2} />
            </button>
          ) : null}
          <button className="btn primary" onClick={() => go(index + 1)}
                  disabled={index >= items.length - 1}>
            Next
          </button>
        </div>
      </footer>

      {showNavigator ? (
        <Navigator items={items} current={index} title={setTitle}
                   onGo={go} onClose={() => setShowNavigator(false)}
                   states={setStates}
                   complete={setComplete}
                   onReviewPage={activeSet ? () => {
                     setShowNavigator(false); setShowSetReview(true)
                   } : undefined} />
      ) : null}

      {showSetReview && activeSet ? (
        <SetReview items={items} current={index} title={setTitle}
                   states={setStates}
                   remaining={remaining}
                   clock={remaining === null ? null : formatCountdown(remaining)}
                   onGo={go}
                   onClose={() => setShowSetReview(false)}
                   onFinish={finishSet} />
      ) : null}

      {showMistake && current ? (
        <MistakeLog key={current.id}
                    mistake={mistake}
                    onClose={() => setShowMistake(false)}
                    onSave={(tags, note) => {
                      void api.saveMistake(current.id, tags, note)
                        .then((r) => setMistake(r.mistake))
                        .catch((e: Error) => setError(e.message))
                    }} />
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
