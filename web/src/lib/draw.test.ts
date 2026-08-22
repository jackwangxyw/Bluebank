/**
 * Drawing a practice set.
 *
 * The one that would hurt in the wild is a repeat: a 20-question set that shows
 * you the same question twice looks like a bug in the bank rather than in the
 * draw. The rest is bounds.
 */
import { describe, expect, it } from 'vitest'
import { sample } from './draw'

const pool = Array.from({ length: 50 }, (_, i) => `q${i}`)

describe('sample', () => {
  it('returns the number asked for', () => {
    expect(sample(pool, 20)).toHaveLength(20)
    expect(sample(pool, 1)).toHaveLength(1)
  })

  it('never repeats a question', () => {
    for (let run = 0; run < 50; run++) {
      const drawn = sample(pool, 20)
      expect(new Set(drawn).size).toBe(20)
    }
  })

  it('only ever returns members of the pool', () => {
    const drawn = sample(pool, 30)
    for (const id of drawn) expect(pool).toContain(id)
  })

  it('caps at the pool when asked for more than exists', () => {
    // Asking for 50 of 10 has to give 10, not 50 with repeats and not a throw.
    expect(sample(pool.slice(0, 10), 50)).toHaveLength(10)
  })

  it('handles the degenerate sizes', () => {
    expect(sample(pool, 0)).toEqual([])
    expect(sample(pool, -5)).toEqual([])
    expect(sample([], 10)).toEqual([])
  })

  it('leaves the pool it was given alone', () => {
    const before = pool.slice()
    sample(pool, 25)
    expect(pool).toEqual(before)
  })

  it('actually varies between draws', () => {
    // Not a randomness test, just a guard against returning the first n.
    const runs = new Set(
      Array.from({ length: 20 }, () => sample(pool, 10).join(',')),
    )
    expect(runs.size).toBeGreaterThan(1)
  })

  it('is exhaustive when the whole pool is drawn', () => {
    const drawn = sample(pool, pool.length)
    expect(drawn.slice().sort()).toEqual(pool.slice().sort())
  })

  it('uses the random source it is handed', () => {
    // Always picking index 0 of what is left walks the pool in order.
    expect(sample(pool, 3, () => 0)).toEqual(['q0', 'q1', 'q2'])
  })
})
