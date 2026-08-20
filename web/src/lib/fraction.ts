/**
 * Exact rational arithmetic on BigInt.
 *
 * This exists because floats cannot grade the SAT. A student typing `0.1765`
 * for a keyed `3/17` has to compare unequal, and `1.5` for `3/2` has to compare
 * equal, and IEEE doubles get both of those wrong often enough to matter. This
 * is the direct replacement for Python's `fractions.Fraction`, and it is
 * deliberately restricted to exactly the syntax that `Fraction(str)` accepts,
 * because the Python behaviour is the spec the tests are written against.
 */

export interface Rational {
  /** Signed numerator of the reduced fraction. */
  n: bigint
  /** Denominator of the reduced fraction, always > 0. */
  d: bigint
}

/**
 * A malformed exponent must not be allowed to build a multi-megabyte BigInt and
 * lock the tab. Real answers never exceed a couple of digits.
 */
const MAX_EXPONENT = 1000

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

/** Reduce to lowest terms with a positive denominator. Null on a zero denominator. */
export function rational(n: bigint, d: bigint): Rational | null {
  if (d === 0n) return null
  let num = n
  let den = d
  if (den < 0n) {
    num = -num
    den = -den
  }
  const g = gcd(num, den) || 1n
  return { n: num / g, d: den / g }
}

/** Both sides are reduced with a positive denominator, so this is exact. */
export function equals(a: Rational, b: Rational): boolean {
  return a.n === b.n && a.d === b.d
}

const INTEGER = /^[-+]?\d+$/

// Mirrors Python's Fraction decimal syntax: optional sign, digits, optional
// fractional part, optional exponent. The lookahead is what rejects a bare "."
// and a bare sign while still allowing ".5".
const DECIMAL = /^([-+]?)(?=\d|\.\d)(\d*)(?:\.(\d*))?(?:[eE]([-+]?\d+))?$/

/**
 * Parse an already-canonicalised numeric string. Returns null for anything that
 * is not a plain number, which is how a non-numeric SPR response is rejected.
 *
 * `a/b` is split first and both halves must be plain integers, matching
 * grading.py, which calls `int()` on each half rather than handing the whole
 * string to Fraction.
 */
export function parseRational(value: string): Rational | null {
  if (!value) return null

  const slash = value.indexOf('/')
  if (slash !== -1) {
    const num = value.slice(0, slash)
    const den = value.slice(slash + 1)
    if (!INTEGER.test(num) || !INTEGER.test(den)) return null
    return rational(BigInt(num), BigInt(den))
  }

  const match = DECIMAL.exec(value)
  if (!match) return null
  const [, sign, whole, frac, exp] = match
  const fraction = frac ?? ''

  let n = BigInt((whole || '0') + fraction)
  let d = 10n ** BigInt(fraction.length)

  if (exp) {
    const e = Number(exp)
    if (!Number.isFinite(e) || Math.abs(e) > MAX_EXPONENT) return null
    if (e > 0) n *= 10n ** BigInt(e)
    else if (e < 0) d *= 10n ** BigInt(-e)
  }

  if (sign === '-') n = -n
  return rational(n, d)
}
