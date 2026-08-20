/**
 * Ported one-for-one from tests/test_backend.py. The Python suite is the spec:
 * if a case here disagrees with the Python one, the port is wrong, not the test.
 *
 * Every case is a real shape found in the bank; the comment names the question
 * it came from. Two of these pin bugs that silently produced *wrong* answer
 * keys, which is worse than a missing one because it teaches you the wrong
 * thing and you never notice.
 */
import { describe, expect, it } from 'vitest'
import { asFraction, canonical, grade, gradeMcq, gradeSpr } from './grading'
import { equals } from './fraction'
import type { StoredQuestion } from '../types'

describe('canonical', () => {
  it('strips leading and trailing zeros, commas, and unicode minus', () => {
    expect(canonical('0.25')).toBe('.25')
    expect(canonical('1.50')).toBe('1.5')
    expect(canonical('  3 / 17 ')).toBe('3/17')
    expect(canonical('1,200')).toBe('1200')
    expect(canonical('−4')).toBe('-4')   // unicode minus
    expect(canonical('0.0')).toBe('0')
  })

  it('does not strip zeros off an integer', () => {
    // The trailing-zero strip must stay guarded on a decimal point being
    // present, or 1200 canonicalises to 12 and every large answer breaks.
    expect(canonical('1200')).toBe('1200')
    expect(canonical('100.00')).toBe('100')
  })

  it('keeps the decimal point in a recovered SPR answer', () => {
    // A .strip(".") here once turned the answer .1667 into 1667, live in the DB.
    expect(canonical('.1667')).toBe('.1667')
    expect(canonical('-0.5')).toBe('-.5')
  })

  it('normalises negative zero and empty input', () => {
    expect(canonical('-0')).toBe('0')
    expect(canonical('')).toBe('')
    expect(canonical(null)).toBe('')
    expect(canonical(undefined)).toBe('')
  })
})

describe('asFraction', () => {
  it('parses equal values written differently', () => {
    const a = asFraction('3/2')
    const b = asFraction('1.5')
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(equals(a!, b!)).toBe(true)
  })

  it('rejects non-numbers and division by zero', () => {
    expect(asFraction('three halves')).toBeNull()
    expect(asFraction('1/0')).toBeNull()
    expect(asFraction('1..2')).toBeNull()
    expect(asFraction('--3')).toBeNull()
    expect(asFraction('')).toBeNull()
  })

  it('matches Python Fraction on exponents and currency', () => {
    // Verified against the Python implementation, not assumed.
    expect(equals(asFraction('1e3')!, asFraction('1000')!)).toBe(true)
    expect(equals(asFraction('2.5e-2')!, asFraction('1/40')!)).toBe(true)
    expect(equals(asFraction('$12.50')!, asFraction('25/2')!)).toBe(true)
  })

  it('is exact where floats are not', () => {
    // 3/17 has no finite binary expansion; a float port passes .1765 here.
    expect(equals(asFraction('3/17')!, asFraction('0.1765')!)).toBe(false)
    expect(equals(asFraction('0.1')!, asFraction('1/10')!)).toBe(true)
  })
})

describe('gradeSpr', () => {
  it('accepts every listed alternate spelling', () => {
    // 65ac5dc5: both truncated and rounded decimals plus the fraction
    const accepted = ['.1764', '.1765', '3/17']
    for (const response of ['0.1764', '.1764', '3/17', '0.1765']) {
      expect(gradeSpr(response, accepted), response).toEqual([true, 'listed'])
    }
    expect(gradeSpr('0.18', accepted)).toEqual([false, null])
  })

  it('accepts a numerically equal but unlisted spelling', () => {
    expect(gradeSpr('1.5', ['3/2'])).toEqual([true, 'equivalent'])
  })

  it('treats a blank response as wrong, not an error', () => {
    expect(gradeSpr('', ['4'])).toEqual([false, null])
    expect(gradeSpr(null, ['4'])).toEqual([false, null])
  })

  it('handles several genuinely different valid answers', () => {
    // 070631-DC: "what is one possible value of x"
    const accepted = ['10/3', '15/4', '25/6', '3.333', '3.75', '4.166', '4.167']
    for (const response of ['10/3', '3.75', '4.167']) {
      expect(gradeSpr(response, accepted)[0], response).toBe(true)
    }
    expect(gradeSpr('5', accepted)[0]).toBe(false)
  })
})

describe('gradeMcq', () => {
  it('is case insensitive', () => {
    expect(gradeMcq('b', ['B'])).toEqual([true, 'listed'])
    expect(gradeMcq('C', ['B'])).toEqual([false, null])
  })

  it('treats a blank response as wrong', () => {
    expect(gradeMcq(null, ['A'])).toEqual([false, null])
  })
})

describe('grade', () => {
  it('carries every accepted form, not just the first', () => {
    const question = {
      id: 'x', type: 'spr', correct: ['10/3', '3.75'], rationale_html: '<p>r</p>',
    } as unknown as StoredQuestion
    const result = grade(question, '3.75')
    expect(result.correct).toBe(true)
    expect(result.accepted).toEqual(['10/3', '3.75'])
  })

  it('shows why the picked choice is wrong, and why the key is right', () => {
    const question = {
      id: 'y', type: 'mcq', correct: ['C'],
      explanations: { A: '<p>no</p>', C: '<p>yes</p>' },
      rationale_html: '<p>full</p>',
    } as unknown as StoredQuestion
    const wrong = grade(question, 'A')
    expect(wrong.correct).toBe(false)
    expect(wrong.why_wrong_html).toBe('<p>no</p>')
    expect(wrong.why_right_html).toBe('<p>yes</p>')

    const right = grade(question, 'C')
    expect(right.correct).toBe(true)
    expect(right.why_wrong_html).toBeNull()
  })
})
