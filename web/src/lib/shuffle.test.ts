/**
 * These pinned values are shared with tests/test_backend.py::TestShuffleKey.
 * The two implementations must agree exactly or the same practice set numbers
 * its questions differently on localhost and on Pages.
 */
import { describe, expect, it } from 'vitest'
import { byShuffleKey, shuffleKey } from './shuffle'

describe('shuffleKey', () => {
  it('matches the Python implementation exactly', () => {
    expect(shuffleKey('002fb221-07c6-4406-a00c-ed57339ea78c')).toBe(6465008710589730716n)
    expect(shuffleKey('015193-DC')).toBe(4362093292545599972n)
    expect(shuffleKey('')).toBe(8442584544778250395n)
    expect(shuffleKey('a')).toBe(198367012849983736n)
  })

  it('fits a signed 64-bit integer', () => {
    for (const id of ['015193-DC', 'a'.repeat(200), '', '−4']) {
      expect(shuffleKey(id) >= 0n).toBe(true)
      expect(shuffleKey(id) < 2n ** 63n).toBe(true)
    }
  })

  it('interleaves the sections', () => {
    // Without the splitmix finalizer this failed: raw FNV-1a put every "m" id
    // before every "r" id because its high bits track the first byte.
    const rows = [
      ...Array.from({ length: 500 }, (_, i) => ({ id: `m${i}`, section: 'MATH' })),
      ...Array.from({ length: 500 }, (_, i) => ({ id: `r${i}`, section: 'RW' })),
    ]
    rows.sort(byShuffleKey)
    const first20 = rows.slice(0, 20).map((r) => r.section)
    expect(first20).toContain('MATH')
    expect(first20).toContain('RW')
  })
})
