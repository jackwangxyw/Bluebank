/**
 * The practice-set ordering. Twin of `shuffle_key` in bluebank/db.py, and it
 * must return the identical value: the pinned test cases are shared.
 *
 * Why this exists: the natural order is section, domain, skill, difficulty, and
 * because MATH sorts before RW that puts all 1,922 Math questions before the
 * first Reading one, with every Easy question ahead of every Hard one inside
 * each skill. Sorting by this key interleaves them.
 *
 * Why a hash of the id rather than a stored shuffle or a seeded RNG:
 *  - the same pool always comes back in the same order, so "question 40" means
 *    the same question tomorrow and on the other backend;
 *  - nothing has to be stored, so there is no seed to migrate;
 *  - a pool update slots new questions in without renumbering the rest.
 *
 * Why FNV-1a rather than blake2b (what the Python used first) or SHA-256:
 * blake2b has no browser equivalent, and WebCrypto's SHA-256 is async, which a
 * sort comparator cannot use. FNV is trivially identical in both languages.
 * It is not a cryptographic hash and does not need to be.
 *
 * The splitmix64 finalizer IS required. Raw FNV-1a barely avalanches into the
 * high bits, which are the bits a sort actually reads: every id starting "m"
 * hashed to 0x08a98..., every id starting "r" to 0x08dc8..., so the "shuffle"
 * was really "sort by first character" and regrouped the sections. See the
 * interleaving test.
 */

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK64 = 0xffffffffffffffffn
const MASK63 = 0x7fffffffffffffffn

const encoder = new TextEncoder()
const cache = new Map<string, bigint>()

/** splitmix64 finalizer: spreads every input bit across all 64 output bits. */
function mix(input: bigint): bigint {
  let z = ((input ^ (input >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64
  return z ^ (z >> 31n)
}

export function shuffleKey(questionId: string): bigint {
  const hit = cache.get(questionId)
  if (hit !== undefined) return hit

  let h = FNV_OFFSET
  for (const byte of encoder.encode(questionId)) {
    h = ((h ^ BigInt(byte)) * FNV_PRIME) & MASK64
  }
  const key = mix(h) & MASK63
  cache.set(questionId, key)
  return key
}

/** Comparator for Array.prototype.sort. BigInt subtraction is not a number. */
export function byShuffleKey(a: { id: string }, b: { id: string }): number {
  const ka = shuffleKey(a.id)
  const kb = shuffleKey(b.id)
  return ka < kb ? -1 : ka > kb ? 1 : 0
}
