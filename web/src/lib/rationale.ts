/**
 * Splitting College Board rationales into per-choice explanations, and
 * recovering answer keys for the legacy `ibn` items that ship without one.
 *
 * Direct port of rationale.py. Everything here is derived from the official
 * rationale text. Nothing is generated or guessed: if a pattern does not match,
 * it is flagged rather than filled in with an invented explanation.
 *
 * PORTING NOTES, because Python and JavaScript regex disagree in ways that
 * silently corrupt answer keys here:
 *
 * - Python's `$` also matches before a trailing newline; JavaScript's does not.
 *   Harmless in this file because every `$` pattern either has `\s` (which
 *   covers `\n`) inside the repeated group, or runs on flatten() output, which
 *   has already collapsed all whitespace.
 * - `re.findall(r"[A-D]", ...)` is deliberately NOT case-insensitive. With the
 *   `i` flag it also matches the "a" and "d" in the connecting word "and",
 *   producing phantom duplicate boundaries.
 * - Python's `\w` is unicode-aware, JavaScript's is ASCII. Only used here for
 *   English adverbs ("also", "all", "incorrectly"), so the two agree.
 * - `_SP` is one-or-more. Writing `${SP}?` gets you a *lazy one-or-more*, not
 *   an optional group, which silently breaks the grouped-rejection pattern.
 *   `SP0` is the genuinely-optional variant. Do not collapse the two.
 */

// `&nbsp;` shows up between words often enough to break a naive \s+ pattern,
// and the choice letter is sometimes wrapped in a tag:
// `Choice <span class="italic">C</span> is incorrect.`
const SP = String.raw`(?:\s|&nbsp;|&#160;|<[^>]*>)+`
const SP0 = String.raw`(?:\s|&nbsp;|&#160;|<[^>]*>)*`

// "Choice B is the best answer because ..." / "Choice A is incorrect because ..."
// The `is` is occasionally missing in the source ("Choice B incorrect.") or
// folded into an adverb ("Choice C incorrectly limits the cost ...").
const SINGLE = new RegExp(String.raw`Choice${SP}([A-D])${SP}(?:is\b|incorrect\w*\b)`, 'gi')

// "Choices A, B, and C are incorrect and may result from conceptual errors."
// The trailing `are incorrect` is required: "Choices B and D show models of the
// form ..." is a mid-explanation reference, not a rejection, and must not split.
// Up to two words may sit between ("are also incorrect", "are all incorrect").
// The plural `s` is optional because the source sometimes writes
// "Choice B, C, and D are incorrect"; two or more letters are required so this
// never competes with SINGLE. The \b around each letter stops [A-D] from
// matching the "a" in "and".
const GROUPED = new RegExp(
  String.raw`Choices?${SP}([A-D]\b(?:${SP0}(?:,${SP0}and\b|,|and\b)${SP0}[A-D]\b)+)` +
  String.raw`${SP}are(?:${SP}\w+){0,2}${SP}incorrect`,
  'gi',
)

const CORRECT_WORDS = /^(?:the\s+)?(?:best\s+answer|correct)\b/i

const VOID_TAGS = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'source', 'col', 'area'])
const TAG = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g

/** True if `pos` falls inside a tag (e.g. within a MathML alttext value). */
function inTag(text: string, pos: number): boolean {
  const lt = text.lastIndexOf('<', pos - 1)
  const gt = text.lastIndexOf('>', pos - 1)
  return lt > gt
}

// Whitespace, tags, and sentence-final closing punctuation ("...Earthly
// Paradise." </p><p>) all sit between the period and the next sentence.
const SKIP_BACK = /(?:\s|&nbsp;|&#160;|<[^>]*>|["')\]”’]|&rdquo;|&rsquo;|&quot;|&#822[01];|&#8217;)+$/

// A line or block break ends a sentence just as firmly as a period. The `ibn`
// rationales use "<p>Incorrect Answer Rationale<br>" headers with no period.
const BLOCK_BREAK = /<\s*\/?\s*(?:br|p|div|li|ul|ol|tr|td|h[1-6])\b/i

/**
 * True if `pos` begins a sentence.
 *
 * Rationales refer to choices mid-sentence ("...choice D is the only graph
 * that passes through the point..."), which is a reference, not the start of
 * that choice's explanation. Only sentence-initial mentions are boundaries.
 */
function atSentenceStart(text: string, pos: number): boolean {
  let head = text.slice(0, pos)
  const skipped = SKIP_BACK.exec(head)
  if (skipped && BLOCK_BREAK.test(skipped[0])) return true
  head = head.replace(SKIP_BACK, '')
  return !head || '.!?:;'.includes(head[head.length - 1])
}

interface OpenTags {
  stack: [string, number][]
  orphans: Set<number>
}

/** Open tags left on the stack, and the positions of closers with no opener. */
function openTags(fragment: string): OpenTags {
  const stack: [string, number][] = []
  const orphans = new Set<number>()
  for (const m of fragment.matchAll(TAG)) {
    const closing = m[1]
    const name = m[2].toLowerCase()
    const selfClose = m[4]
    if (VOID_TAGS.has(name) || selfClose) continue
    if (closing) {
      if (stack.some(([n]) => n === name)) {
        while (stack.length && stack[stack.length - 1][0] !== name) stack.pop()
        stack.pop()
      } else {
        orphans.add(m.index)
      }
    } else {
      stack.push([name, m.index])
    }
  }
  return { stack, orphans }
}

/**
 * Close tags left open by cutting, and drop closers whose opener was cut off.
 *
 * Segments are carved out of the middle of the rationale HTML, so both ends can
 * land inside a <p>. The UI injects this HTML directly, so it has to be well
 * formed.
 */
function balance(fragment: string): string {
  let out = fragment
  let { stack, orphans } = openTags(out)
  if (orphans.size) {
    const parts: string[] = []
    let last = 0
    for (const m of out.matchAll(TAG)) {
      if (orphans.has(m.index)) {
        parts.push(out.slice(last, m.index))
        last = m.index + m[0].length
      }
    }
    parts.push(out.slice(last))
    out = parts.join('')
    stack = openTags(out).stack
  }
  for (let i = stack.length - 1; i >= 0; i--) out += `</${stack[i][0]}>`
  return out.trim()
}

type Mark = [number, string[], number]

export interface SplitResult {
  explanations: Record<string, string>
  flags: string[]
}

/**
 * Split one rationale into {label: html}.
 *
 * A missing label is left out of the dict and named in flags rather than
 * filled with a guess.
 */
export function splitExplanations(
  rationaleHtml: string | null | undefined,
  labels: string[] = ['A', 'B', 'C', 'D'],
): SplitResult {
  const flags: string[] = []
  if (!rationaleHtml) return { explanations: {}, flags: ['empty_rationale'] }

  const usable = (pos: number) =>
    !inTag(rationaleHtml, pos) && atSentenceStart(rationaleHtml, pos)

  const singles: Mark[] = []
  const groups: Mark[] = []
  for (const m of rationaleHtml.matchAll(SINGLE)) {
    if (usable(m.index)) singles.push([m.index, [m[1].toUpperCase()], m.index + m[0].length])
  }
  for (const m of rationaleHtml.matchAll(GROUPED)) {
    if (!usable(m.index)) continue
    // Case-sensitive on purpose: [A-D] with the `i` flag also matches the
    // "a" and "d" in the connecting word "and".
    const letters = m[1].match(/[A-D]/g) ?? []
    if (letters.length) groups.push([m.index, letters, m.index + m[0].length])
  }

  // A letter mentioned twice at sentence start ("Choice A is a point with
  // x-coordinate r" inside A's own explanation) is a self-reference, not a
  // second segment. Keep the first and drop the rest entirely, so the first
  // segment is not truncated at the reference.
  const marks: Mark[] = []
  const claimed = new Set<string>()
  for (const [start, letters, end] of singles) {
    const letter = letters[0]
    if (claimed.has(letter)) continue
    claimed.add(letter)
    marks.push([start, letters, end])
  }

  // An individual explanation is more specific than a blanket "Choices A, B,
  // and D are incorrect", so singles win. A group whose letters are all
  // already covered still terminates the preceding segment, but contributes
  // no explanation of its own.
  for (const [start, letters, end] of groups) {
    marks.push([start, letters.filter((l) => !claimed.has(l)), end])
  }
  for (const [, letters] of groups) for (const l of letters) claimed.add(l)

  if (!marks.some(([, letters]) => letters.length)) {
    return { explanations: {}, flags: ['no_choice_boundaries'] }
  }

  marks.sort((a, b) => a[0] - b[0])
  // Drop a boundary swallowed by an earlier match.
  const pruned: Mark[] = []
  for (const mark of marks) {
    if (pruned.length && mark[0] < pruned[pruned.length - 1][2]) continue
    pruned.push(mark)
  }

  const out: Record<string, string> = {}
  pruned.forEach(([start, letters], i) => {
    const end = i + 1 < pruned.length ? pruned[i + 1][0] : rationaleHtml.length
    const segment = balance(rationaleHtml.slice(start, end))
    for (const letter of letters) {
      if (letter in out) flags.push(`duplicate_boundary_${letter}`)
      else out[letter] = segment
    }
  })

  const missing = labels.filter((l) => !(l in out))
  if (missing.length) flags.push('missing_explanations_' + missing.join(''))
  return { explanations: out, flags }
}

/** 'correct' or 'incorrect', read from the official wording itself. */
export function classify(explanationHtml: string | null | undefined): string {
  const html = explanationHtml || ''
  const m = new RegExp(SINGLE.source, 'i').exec(html)
  if (!m) {
    if (new RegExp(`are${SP}incorrect`, 'i').test(html)) return 'incorrect'
    return 'unknown'
  }
  const tail = unescapeHtml(
    html.slice(m.index + m[0].length).replace(/<[^>]+>/g, ' '),
  ).trim()
  return CORRECT_WORDS.test(tail) ? 'correct' : 'incorrect'
}

// ---------------------------------------------------------------------------
// Answer-key recovery for the 81 keyless `ibn` items (handoff section 4).
// ---------------------------------------------------------------------------

const WAYS = /Note that (.+?) (?:are|is) (?:examples?|an example) of ways to enter/i
// The terminator must be a sentence-ending period (followed by space or end of
// string). A bare [^.] class would cut "0.25" down to "0".
const SPR_FALLBACK = /correct answer is\s*:?\s*(.+?)\s*(?:\.\s|\.$|$)/i
const MCQ_FALLBACK = /Choice\s+([A-D])\s+is\s+(?:the\s+)?(?:best|correct)/gi
const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\/[+-]?\d+(?:\.\d*)?)?$/

/**
 * Strip spaces and thousands commas; SPR entry accepts neither. Returns the
 * enterable string, or null if it is not a plain number.
 *
 * Only the trailing period comes off: stripping "." from both ends would turn
 * the answer `.1667` into `1667`, which was live in the database once.
 */
function enterable(value: string): string | null {
  const v = value.trim().replace(/\.+$/, '').replace(/ /g, '').replace(/,/g, '')
  return v && NUMERIC.test(v) ? v : null
}

/**
 * HTML to plain text, promoting img alt text to inline words.
 *
 * The keyless items render their math as base64 images; the alt attribute is
 * the only place the value survives.
 */
export function flatten(html: string | null | undefined): string {
  let h = (html || '').replace(/<img[^>]*\balt="([^"]*)"[^>]*>/g, ' $1 ')
  h = h.replace(/<[^>]+>/g, ' ')
  return unescapeHtml(h).split(/\s+/).filter(Boolean).join(' ')
}

export interface SprRecovery { answers: string[]; flags: string[] }

/** Empty answers means recovery failed, loudly. */
export function recoverSprAnswers(rationaleHtml: string | null | undefined): SprRecovery {
  const text = flatten(rationaleHtml)

  const ways = WAYS.exec(text)
  if (ways) {
    const answers = ways[1]
      .split(/,|\band\b/)
      .map(enterable)
      .filter((v): v is string => v !== null)
    if (answers.length) return { answers, flags: [] }
    return { answers: [], flags: ['ways_to_enter_no_numeric'] }
  }

  const fallback = SPR_FALLBACK.exec(text)
  if (fallback) {
    const value = enterable(fallback[1])
    if (value) return { answers: [value], flags: [] }
    // 'three halves', 'e' -- screen-reader prose, not an enterable value.
    return { answers: [], flags: ['spr_answer_not_numeric'] }
  }
  return { answers: [], flags: ['spr_no_answer_pattern'] }
}

export interface McqRecovery { letter: string | null; flags: string[] }

/** Ambiguity is a flag, never a guess. */
export function recoverMcqAnswer(rationaleHtml: string | null | undefined): McqRecovery {
  const text = flatten(rationaleHtml)
  const letters = new Set<string>()
  for (const m of text.matchAll(MCQ_FALLBACK)) letters.add(m[1].toUpperCase())
  if (letters.size === 1) return { letter: [...letters][0], flags: [] }
  if (!letters.size) return { letter: null, flags: ['mcq_no_correct_pattern'] }
  return { letter: null, flags: ['mcq_ambiguous_' + [...letters].sort().join('')] }
}

// ---------------------------------------------------------------------------
// Entity decoding
// ---------------------------------------------------------------------------

/**
 * Stand-in for Python's html.unescape.
 *
 * An explicit table rather than a DOM lookup. The first attempt resolved named
 * entities through a detached <textarea>, which works in a browser and silently
 * returns the raw entity everywhere else. The differential run against the
 * Python corpus failed on 2,492 of 3,767 questions because of it. A table has
 * no environment dependency and no silent-wrong mode.
 *
 * These are every named entity that occurs anywhere in the bank (rationales,
 * stimuli, stems, and options), generated from the corpus and resolved with
 * Python's own html.unescape, plus the core five. Note that nbsp is U+00A0,
 * not a plain space.
 *
 * If the bank ever gains a new entity, decoding leaves it as literal text and
 * unknownEntities collects it, so it surfaces rather than corrupting quietly.
 */
const ENTITIES: Record<string, string> = {
  Aacute: '\u00c1',
  Ccedil: '\u00c7',
  Eacute: '\u00c9',
  Oacute: '\u00d3',
  Ocirc: '\u00d4',
  Prime: '\u2033',
  aacute: '\u00e1',
  acirc: '\u00e2',
  aelig: '\u00e6',
  amp: '&',
  ang: '\u2220',
  apos: '\u0027',
  atilde: '\u00e3',
  auml: '\u00e4',
  copy: '\u00a9',
  deg: '\u00b0',
  divide: '\u00f7',
  eacute: '\u00e9',
  ecirc: '\u00ea',
  egrave: '\u00e8',
  emsp: '\u2003',
  ensp: '\u2002',
  euml: '\u00eb',
  ge: '\u2265',
  gt: '>',
  hellip: '\u2026',
  iacute: '\u00ed',
  igrave: '\u00ec',
  iuml: '\u00ef',
  ldquo: '\u201c',
  le: '\u2264',
  lsquo: '\u2018',
  lt: '<',
  macr: '\u00af',
  mdash: '\u2014',
  micro: '\u00b5',
  middot: '\u00b7',
  minus: '\u2212',
  nbsp: '\u00a0',
  ndash: '\u2013',
  ne: '\u2260',
  ntilde: '\u00f1',
  oacute: '\u00f3',
  ocirc: '\u00f4',
  ordf: '\u00aa',
  oslash: '\u00f8',
  otilde: '\u00f5',
  ouml: '\u00f6',
  pi: '\u03c0',
  plusmn: '\u00b1',
  prime: '\u2032',
  quot: '"',
  rdquo: '\u201d',
  rsquo: '\u2019',
  sbquo: '\u201a',
  scaron: '\u0161',
  sdot: '\u22c5',
  shy: '\u00ad',
  sup2: '\u00b2',
  times: '\u00d7',
  uacute: '\u00fa',
  uuml: '\u00fc',
}

/** Named entities seen at runtime that are not in the table above. */
export const unknownEntities = new Set<string>()

export function unescapeHtml(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(
    /&(#\d+;|#[xX][0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]*;)/g,
    (whole, body: string) => {
      if (body[0] === '#') {
        const hex = body[1] === 'x' || body[1] === 'X'
        const code = parseInt(hex ? body.slice(2, -1) : body.slice(1, -1), hex ? 16 : 10)
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole
        // Lone surrogates are not valid code points and would throw.
        if (code >= 0xd800 && code <= 0xdfff) return whole
        return String.fromCodePoint(code)
      }
      const name = body.slice(0, -1)
      const value = ENTITIES[name]
      if (value === undefined) {
        unknownEntities.add(name)
        return whole
      }
      return value
    },
  )
}
