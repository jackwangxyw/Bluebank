/**
 * Ported one-for-one from tests/test_backend.py. The Python suite is the spec:
 * if a case here disagrees with the Python one, the port is wrong.
 *
 * The HTML in these cases is paraphrased rather than copied out of the bank,
 * but every *shape* is real and the comment names the question it came from.
 * No College Board content is committed.
 *
 * This file is the standing guard. It was backed by a one-off differential run
 * over the whole live corpus: all 3,767 rationales split identically to Python,
 * every explanation classified identically, and every recovered key identical.
 * Re-run that (see HANDOFF section 7c) after any change here.
 */
import { describe, expect, it } from 'vitest'
import {
  classify, flatten, recoverMcqAnswer, recoverSprAnswers, splitExplanations, unescapeHtml,
} from './rationale'

describe('splitExplanations', () => {
  it('splits four choices and classifies them', () => {
    const html = '<p>Choice B is the best answer because it works. '
      + 'Choice A is incorrect because no. Choice C is incorrect because no. '
      + 'Choice D is incorrect because no.</p>'
    const { explanations, flags } = splitExplanations(html)
    expect(flags).toEqual([])
    expect(Object.keys(explanations).sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(classify(explanations.B)).toBe('correct')
    expect(classify(explanations.A)).toBe('incorrect')
  })

  it('handles &nbsp; between the letter and "is"', () => {
    // 2b5d289b
    const html = '<p>Choice A&nbsp;is the best answer. Yes. Choice B is incorrect. No. '
      + 'Choice C is incorrect. No. Choice D&nbsp;is incorrect. No.</p>'
    const { explanations, flags } = splitExplanations(html)
    expect(flags).toEqual([])
    expect(classify(explanations.A)).toBe('correct')
  })

  it('handles the letter wrapped in a tag', () => {
    // 028920-DC
    const html = '<p>Choice D is correct. Yes. Choice A is incorrect. No. '
      + 'Choice B is incorrect. No. '
      + 'Choice <span class="italic">C</span> is incorrect. No.</p>'
    const { explanations, flags } = splitExplanations(html)
    expect(flags).toEqual([])
    expect(explanations).toHaveProperty('C')
  })

  it('handles a grouped rejection', () => {
    // c324ef1d
    const html = '<p>Choice D is correct. Because reasons. '
      + 'Choices A, B, and C are incorrect and may result from conceptual errors.</p>'
    const { explanations, flags } = splitExplanations(html)
    expect(flags).toEqual([])
    expect(Object.keys(explanations).sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(explanations.A).toBe(explanations.B)
    expect(classify(explanations.A)).toBe('incorrect')
  })

  it('handles the singular-with-a-list typo and an adverb', () => {
    // 026230-DC "Choice B, C, and D are incorrect"; 04108-DC "are also incorrect"
    for (const lead of ['Choice B, C, and D are incorrect.',
                        'Choices B, C, and D are also incorrect.']) {
      const { explanations, flags } =
        splitExplanations(`<p>Choice A is correct. Yes. ${lead}</p>`)
      expect(flags, lead).toEqual([])
      expect(Object.keys(explanations).sort(), lead).toEqual(['A', 'B', 'C', 'D'])
    }
  })

  it('lets an individual explanation beat a grouped one', () => {
    // 08453-DC carries both forms; the specific one must win
    const html = '<p>Choice C is correct. Yes. '
      + 'Choices A, B, and D are incorrect and are the result of an error. '
      + 'Choice A is incorrect because the graphs intersect. '
      + 'Choice B is incorrect because of one intersection. '
      + 'Choice D is incorrect because a line cannot intersect twice.</p>'
    const { explanations, flags } = splitExplanations(html)
    expect(flags).toEqual([])
    expect(explanations.A).toContain('the graphs intersect')
    expect(explanations.A).not.toContain('the result of an error')
  })

  it('does not treat a mid-sentence reference as a boundary', () => {
    // 9025546d: "...choice D is the only graph that passes through..."
    const html = '<p>Choice D is correct. It is given that x is 2, so choice D is the only '
      + 'graph that passes through the point. Choice A is incorrect. No. '
      + 'Choice B is incorrect. No. Choice C is incorrect. No.</p>'
    const { explanations, flags } = splitExplanations(html)
    expect(flags).toEqual([])
    expect(explanations.D).toContain('only graph that passes through')
  })

  it('does not treat a plural reference without "are incorrect" as a boundary', () => {
    // dbe25324: "Choices B and D show models of the form ..."
    const html = '<p>Choice B is correct. Choices B and D show models of the form y = mx. '
      + 'Choice A is incorrect. No. Choice C is incorrect. No. '
      + 'Choice D is incorrect. No.</p>'
    const { explanations, flags } = splitExplanations(html)
    expect(flags).toEqual([])
    expect(explanations.B).toContain('show models of the form')
  })

  it('handles a sentence ending in a closing quote', () => {
    // 27c4515e
    const html = '<p>Choice A is the best answer. It agrees with "poems" and "works."</p>'
      + '<p>Choice B is incorrect. No.</p><p>Choice C is incorrect. No.</p>'
      + '<p>Choice D is incorrect. No.</p>'
    const { explanations, flags } = splitExplanations(html)
    expect(flags).toEqual([])
    expect(Object.keys(explanations).sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('treats a <br> header as a sentence start', () => {
    // 01239-DC: these headers carry no terminating period
    const html = '<p>Correct Answer Rationale<br>\nChoice C is correct. Yes.'
      + '<p>Incorrect Answer Rationale<br>\nChoices A, B, and D are incorrect. No.'
    const { explanations, flags } = splitExplanations(html)
    expect(flags).toEqual([])
    expect(Object.keys(explanations).sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('flags a missing explanation rather than inventing one', () => {
    const html = '<p>Choice D is correct. Yes. Choice B is incorrect. No.</p>'
    const { explanations, flags } = splitExplanations(html)
    expect(flags).toContain('missing_explanations_AC')
    expect(explanations).not.toHaveProperty('A')
  })

  it('returns balanced html', () => {
    // Cutting mid-paragraph leaves A with an unclosed <p> and B with an orphan
    // </p>; both must come back well formed because the UI injects them.
    const html = '<p>Choice A is correct. Yes. Choice B is incorrect. No.</p>'
    const { explanations } = splitExplanations(html, ['A', 'B'])
    for (const part of Object.values(explanations)) {
      expect((part.match(/<p>/g) ?? []).length, part)
        .toBe((part.match(/<\/p>/g) ?? []).length)
    }
    expect(explanations.A.startsWith('Choice A')).toBe(true)
    expect(explanations.B.startsWith('Choice B')).toBe(true)
  })

  it('closes an unclosed tag', () => {
    const html = '<p><em>Choice A is correct. Yes.</em> Text. <p>Choice B is incorrect.'
    const { explanations } = splitExplanations(html, ['A', 'B'])
    const a = explanations.A
    expect((a.match(/<p>/g) ?? []).length).toBe((a.match(/<\/p>/g) ?? []).length)
    expect((a.match(/<em>/g) ?? []).length).toBe((a.match(/<\/em>/g) ?? []).length)
  })

  it('flags an empty rationale', () => {
    expect(splitExplanations('').flags).toEqual(['empty_rationale'])
    expect(splitExplanations(null).flags).toEqual(['empty_rationale'])
  })
})

describe('answer-key recovery', () => {
  it('prefers "ways to enter" over prose', () => {
    // 070615-DC: prose says "three halves", the enterable forms are 3/2 and 1.5
    const text = '<p>The correct answer is three halves. Note that 3/2 and 1.5 are examples '
      + 'of ways to enter a correct answer.</p>'
    const { answers, flags } = recoverSprAnswers(text)
    expect(flags).toEqual([])
    expect(answers).toEqual(['3/2', '1.5'])
  })

  it('keeps a leading decimal point', () => {
    // 070632-DC: .1667 must not become 1667. This was live in the DB once.
    const text = '<p>The correct answer is one sixth. Note that 1/6, .1666, .1667, 0.166, '
      + 'and 0.167 are examples of ways to enter a correct answer.</p>'
    expect(recoverSprAnswers(text).answers)
      .toEqual(['1/6', '.1666', '.1667', '0.166', '0.167'])
  })

  it('does not truncate a decimal at the point', () => {
    // A [^.] terminator captured "0" out of "The correct answer is 0.25."
    const { answers, flags } = recoverSprAnswers('<p>The correct answer is 0.25.</p>')
    expect(flags).toEqual([])
    expect(answers).toEqual(['0.25'])
  })

  it('strips a thousands comma', () => {
    // 070922-DC
    const { answers, flags } = recoverSprAnswers('<p>The correct answer is 3,540.</p>')
    expect(flags).toEqual([])
    expect(answers).toEqual(['3540'])
  })

  it('promotes img alt text', () => {
    // The keyless items render their math as base64 images; alt is the only
    // place the value survives.
    const text = '<p>The correct answer is <img src="data:image/png;base64,AAA" alt="117">.</p>'
    expect(recoverSprAnswers(text).answers).toEqual(['117'])
  })

  it('flags a prose-only answer rather than guessing', () => {
    const { answers, flags } = recoverSprAnswers('<p>The correct answer is e.</p>')
    expect(answers).toEqual([])
    expect(flags).toEqual(['spr_answer_not_numeric'])
  })

  it('recovers an MCQ letter only when exactly one is named', () => {
    expect(recoverMcqAnswer('<p>Choice C is the best answer.</p>'))
      .toEqual({ letter: 'C', flags: [] })
  })

  it('flags MCQ ambiguity rather than guessing', () => {
    const { letter, flags } =
      recoverMcqAnswer('<p>Choice C is correct. Choice A is the best answer.</p>')
    expect(letter).toBeNull()
    expect(flags).toEqual(['mcq_ambiguous_AC'])
  })
})

describe('unescapeHtml', () => {
  it('decodes the entities the bank actually uses', () => {
    // nbsp is U+00A0, not a plain space. A DOM-based decoder returned these
    // undecoded outside a browser and broke 2,492 of 3,767 flatten() cases.
    expect(unescapeHtml('a&rsquo;b')).toBe('a’b')
    expect(unescapeHtml('a&nbsp;b')).toBe('a b')
    expect(unescapeHtml('&ldquo;x&rdquo;')).toBe('“x”')
    expect(unescapeHtml('&amp;&lt;&gt;')).toBe('&<>')
    expect(unescapeHtml('&#8217;')).toBe('’')
    expect(unescapeHtml('&#x2019;')).toBe('’')
  })

  it('leaves an unknown entity as literal text', () => {
    expect(unescapeHtml('&notarealentity;')).toBe('&notarealentity;')
  })

  it('is a no-op on text with no entities', () => {
    expect(unescapeHtml('plain text')).toBe('plain text')
  })
})

describe('flatten', () => {
  it('strips tags, promotes alt text, and collapses whitespace', () => {
    expect(flatten('<p>a  <b>b</b>\n c</p>')).toBe('a b c')
    expect(flatten('<img alt="42" src="x">')).toBe('42')
    expect(flatten(null)).toBe('')
  })
})
