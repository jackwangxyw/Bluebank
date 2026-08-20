import { useEffect, useRef, useState } from 'react'
import { RichText } from './RichText'
import { Explanation } from './Explanation'
import { BookmarkFilled, Icon, SplitHandle } from './Icon'
import type { Annotation, GradeResult, Question } from '../types'

interface Props {
  question: Question
  number: number
  annotations: Annotation[]
  result: GradeResult | null
  seconds: number
  response: string | null
  flagged: boolean
  crossOutMode: boolean
  crossOut: Set<string>
  onRespond: (value: string | null) => void
  onSubmit: () => void
  onToggleFlag: () => void
  onToggleCrossOutMode: () => void
  onToggleCrossOut: (label: string) => void
  onAddAnnotation: (a: Omit<Annotation, 'id'>) => void
  onRemoveAnnotation: (id: number) => void
}

interface PendingSelection {
  field: string
  start: number
  end: number
  x: number
  y: number
}

const COLORS = ['yellow', 'blue', 'pink'] as const

export function QuestionView(props: Props) {
  const {
    question, number, annotations, result, seconds, response, flagged,
    crossOutMode, crossOut, onRespond, onSubmit, onToggleFlag,
    onToggleCrossOutMode, onToggleCrossOut, onAddAnnotation, onRemoveAnnotation,
  } = props

  const [pending, setPending] = useState<PendingSelection | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [split, setSplit] = useState(50)
  const dragging = useRef(false)

  const answered = result !== null
  const hasStimulus = Boolean(question.stimulus_html?.trim())
  const isSplit = hasStimulus && question.section === 'RW'

  useEffect(() => { setPending(null); setNoteDraft('') }, [question.id])

  useEffect(() => {
    function move(event: MouseEvent) {
      if (!dragging.current) return
      setSplit(Math.min(72, Math.max(28, (event.clientX / window.innerWidth) * 100)))
    }
    function up() { dragging.current = false; document.body.classList.remove('dragging') }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  function startDrag() {
    dragging.current = true
    document.body.classList.add('dragging')
  }

  function handleSelect(range: { field: string; start: number; end: number }) {
    const selection = window.getSelection()
    const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null
    setPending({
      ...range,
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? rect.top : 120,
    })
    setNoteDraft('')
  }

  function commit(color: string) {
    if (!pending) return
    onAddAnnotation({
      field: pending.field,
      start_offset: pending.start,
      end_offset: pending.end,
      color,
      note: noteDraft.trim() || null,
    })
    window.getSelection()?.removeAllRanges()
    setPending(null)
    setNoteDraft('')
  }

  const stimulus = hasStimulus ? (
    <RichText className="passage" html={question.stimulus_html} field="stimulus"
              annotations={annotations} onSelect={handleSelect}
              onAnnotationClick={onRemoveAnnotation} />
  ) : null

  const prompt = (
    <div className="prompt">
      {hasStimulus && !isSplit ? <div className="figure">{stimulus}</div> : null}

      <div className="q-head">
        <span className="q-num">{number}</span>
        <button className={flagged ? 'markbtn on' : 'markbtn'} onClick={onToggleFlag}>
          {flagged ? <BookmarkFilled size={17} /> : <Icon name="bookmark" size={17} />}
          <span>{flagged ? 'Marked for Review' : 'Mark for Review'}</span>
        </button>

        <span className="q-head-spacer" />

        {question.type === 'mcq' ? (
          <button className={crossOutMode ? 'strike on' : 'strike'}
                  onClick={onToggleCrossOutMode}
                  aria-pressed={crossOutMode}
                  disabled={answered}
                  title="Cross out answer choices">
            <span className="strike-letters">ABC</span>
          </button>
        ) : null}
      </div>

      <RichText className="stem" html={question.stem_html} field="stem"
                annotations={annotations} onSelect={handleSelect}
                onAnnotationClick={onRemoveAnnotation} />

      {question.type === 'mcq' && question.options ? (
        <ul className="choices">
          {question.options.map((option) => {
            const isCrossed = crossOut.has(option.label)
            const isPicked = response === option.label
            const isKey = answered && result!.accepted.includes(option.label)
            const isWrongPick = answered && isPicked && !result!.correct
            return (
              <li key={option.label}
                  className={[
                    'choice',
                    isPicked ? 'picked' : '',
                    isCrossed ? 'crossed' : '',
                    isKey ? 'is-key' : '',
                    isWrongPick ? 'is-wrongpick' : '',
                  ].filter(Boolean).join(' ')}>
                <button className="choice-main"
                        disabled={answered || isCrossed}
                        onClick={() => onRespond(option.label)}>
                  <span className="bubble">{option.label}</span>
                  <RichText className="choice-text" html={option.html}
                            field={`option:${option.label}`} annotations={annotations} />
                </button>
                {crossOutMode && !answered ? (
                  <button className={isCrossed ? 'crossbtn on' : 'crossbtn'}
                          title={isCrossed ? 'Undo cross out' : `Cross out ${option.label}`}
                          onClick={() => onToggleCrossOut(option.label)}>
                    {option.label}
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="spr">
          <label htmlFor="spr-input">Enter your answer</label>
          <input id="spr-input" className="spr-input" value={response ?? ''}
                 disabled={answered} autoComplete="off" placeholder="—"
                 onChange={(e) => onRespond(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter' && response) onSubmit() }} />
        </div>
      )}

      {!answered ? (
        <button className="btn primary submit" disabled={!response} onClick={onSubmit}>
          Submit answer
        </button>
      ) : (
        <Explanation result={result!} question={question} seconds={seconds} />
      )}
    </div>
  )

  return (
    <div className="qview">
      {isSplit ? (
        <div className="split" style={{ gridTemplateColumns: `${split}% 4px 1fr` }}>
          <div className="pane">{stimulus}</div>
          <div className="divider" onMouseDown={startDrag}>
            <span className="grab" onMouseDown={startDrag}>
              <SplitHandle />
            </span>
          </div>
          <div className="pane">{prompt}</div>
        </div>
      ) : (
        <div className="single"><div className="pane">{prompt}</div></div>
      )}

      {pending ? (
        <div className="hl-menu"
             style={{
               left: Math.min(window.innerWidth - 190, Math.max(190, pending.x)),
               top: Math.max(58, pending.y - 12),
             }}>
          {COLORS.map((color) => (
            <button key={color} className={`swatch sw-${color}`}
                    title={`Highlight ${color}`} onClick={() => commit(color)} />
          ))}
          <button className="hl-icon" title="Underline" onClick={() => commit('underline')}>
            <Icon name="underline" size={16} />
          </button>
          <span className="hl-sep" />
          <input className="hl-note" placeholder="Add a note" value={noteDraft}
                 onChange={(e) => setNoteDraft(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') commit('yellow') }} />
          <button className="hl-icon" title="Cancel"
                  onClick={() => { setPending(null); setNoteDraft('') }}>
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : null}
    </div>
  )
}
