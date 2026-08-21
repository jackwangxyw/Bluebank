/**
 * Outbox key round trip.
 *
 * These keys decide which local rows get pushed on the next sync, so a parse
 * bug does not throw, it silently stops syncing one category of change. Both
 * real id shapes in the bank are pinned below.
 *
 * The IndexedDB half of store.ts (the v1 -> v2 migration, the outbox store
 * itself) is not covered here: there is no IndexedDB in this environment and
 * the project deliberately avoids adding a shim for one. It is verified in a
 * real browser instead, see HANDOFF section 7d.
 */
import { describe, expect, it } from 'vitest'
import { outboxKey, parseOutboxKey } from './store'

describe('outbox keys', () => {
  it('round trips both id shapes in the bank', () => {
    // A College Board external_id, and a legacy ibn. Both contain hyphens.
    for (const id of ['002fb221-07c6-4406-a00c-ed57339ea78c', '015193-DC']) {
      for (const kind of ['attempt', 'mark', 'annotation'] as const) {
        expect(parseOutboxKey(outboxKey(kind, id))).toEqual({ kind, id })
      }
    }
  })

  it('splits on the first colon only', () => {
    // No id in the bank contains a colon today. If one ever does, the id must
    // survive whole rather than being truncated at the second separator.
    expect(parseOutboxKey('mark:weird:id')).toEqual({ kind: 'mark', id: 'weird:id' })
  })

  it('rejects malformed keys instead of inventing a kind', () => {
    for (const bad of ['', 'attempt', 'attempt:', ':abc', 'bogus:abc', 'Attempt:abc']) {
      expect(parseOutboxKey(bad)).toBeNull()
    }
  })

  it('collapses repeated edits to the same thing', () => {
    // The store is keyed by this string, so flagging a question twice before a
    // sync must produce one entry, not two.
    expect(outboxKey('mark', 'q1')).toBe(outboxKey('mark', 'q1'))
    expect(outboxKey('mark', 'q1')).not.toBe(outboxKey('annotation', 'q1'))
  })
})
