// @vitest-environment jsdom
/**
 * "Exclude Active Questions": the questions that also sit on an official
 * full-length practice test, which you may not want spoiled.
 *
 * The list comes from College Board's own lookup endpoint, the same one their
 * bank uses for the same filter. Two rules are copied from how they apply it,
 * and both are load-bearing:
 *
 *   - the lists hold external_ids, so an `ibn` item can never be on a test;
 *   - each list is checked against its own section only.
 *
 * The localhost build resolves this once at normalize time into a `live`
 * column and this build resolves it per question at filter time, so the two
 * have to agree or the same filter would offer different sets on the two
 * backends. tests/test_backend.py::TestExcludeLive pins the Python twin
 * against the same cases.
 */
import { describe, expect, it } from 'vitest'
import { isLive } from '../apiLocal'
import type { Stub } from './normalize'
import type { Section } from '../types'

const live: Record<Section, Set<string>> = {
  RW: new Set(['rw-live']),
  MATH: new Set(['math-live']),
}

const stub = (over: Partial<Stub> & Pick<Stub, '_id' | '_path' | '_section'>): Stub =>
  ({ ...over }) as Stub

describe('isLive', () => {
  it('matches an external_id in its own section', () => {
    expect(isLive(stub({ _id: 'rw-live', _path: 'external_id', _section: 'RW' }), live))
      .toBe(true)
    expect(isLive(stub({ _id: 'math-live', _path: 'external_id', _section: 'MATH' }), live))
      .toBe(true)
  })

  it('leaves a question that is not on any list alone', () => {
    expect(isLive(stub({ _id: 'nowhere', _path: 'external_id', _section: 'RW' }), live))
      .toBe(false)
  })

  it('never marks an ibn item live', () => {
    // The id is deliberately in the RW list. The path is what decides.
    expect(isLive(stub({ _id: 'rw-live', _path: 'ibn', _section: 'RW' }), live))
      .toBe(false)
  })

  it('does not let one section\'s list reach into the other', () => {
    // A Reading id colliding with a Math id must not take the Math question out.
    expect(isLive(stub({ _id: 'rw-live', _path: 'external_id', _section: 'MATH' }), live))
      .toBe(false)
    expect(isLive(stub({ _id: 'math-live', _path: 'external_id', _section: 'RW' }), live))
      .toBe(false)
  })

  it('treats an empty list as nothing to exclude', () => {
    // What a failed lookup fetch leaves behind. The filter then removes nothing
    // rather than removing everything.
    const none: Record<Section, Set<string>> = { RW: new Set(), MATH: new Set() }
    expect(isLive(stub({ _id: 'rw-live', _path: 'external_id', _section: 'RW' }), none))
      .toBe(false)
  })
})
