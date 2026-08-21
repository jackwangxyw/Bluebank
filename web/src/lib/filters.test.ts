// @vitest-environment jsdom
/**
 * The multi-select filter rule, which is the same in both backends: values
 * inside one filter are OR'd, filters are AND'd with each other, and an empty
 * filter is OFF rather than "matches nothing".
 *
 * That last one is the whole risk. Read the other way it produces `IN ()` on
 * the Python side and a permanently empty practice set on this one.
 * tests/test_backend.py::TestFilterSql pins the same rules for the SQL.
 */
import { describe, expect, it } from 'vitest'
import { anyOf } from '../apiLocal'

describe('anyOf', () => {
  it('treats a missing or empty filter as off', () => {
    expect(anyOf(undefined, 'H')).toBe(true)
    expect(anyOf([], 'H')).toBe(true)
    expect(anyOf([], undefined)).toBe(true)
  })

  it('ORs the values inside one filter', () => {
    // The case that prompted this: medium and hard together.
    expect(anyOf(['M', 'H'], 'M')).toBe(true)
    expect(anyOf(['M', 'H'], 'H')).toBe(true)
    expect(anyOf(['M', 'H'], 'E')).toBe(false)
  })

  it('rejects a question whose value is missing when a filter is set', () => {
    // A stub with no difficulty must not slip through a difficulty filter.
    expect(anyOf(['M'], undefined)).toBe(false)
  })
})
