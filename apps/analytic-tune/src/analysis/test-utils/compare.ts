// Test-only: bit-exact comparison of the port's arrays against upstream's.
import { expect } from 'vitest'

function same(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b))
}

/**
 * Expect `mine` to equal `theirs` bit for bit. With `allowTrailingNaN`, upstream may be longer
 * by elements that are NaN or undefined (its hand-written loops run one past the end).
 */
export function expectBitEqual(
  mine: ArrayLike<number>,
  theirs: ArrayLike<number | undefined>,
  label: string,
  allowTrailingNaN = false
): void {
  if (allowTrailingNaN) {
    expect(theirs.length, `${label} length`).toBeGreaterThanOrEqual(mine.length)
    for (let i = mine.length; i < theirs.length; i++) {
      const v = theirs[i]
      expect(v === undefined || Number.isNaN(v), `${label}[${i}] trailing`).toBe(true)
    }
  } else {
    expect(mine.length, `${label} length`).toBe(theirs.length)
  }
  for (let i = 0; i < mine.length; i++) {
    if (!same(mine[i], theirs[i])) expect(mine[i], `${label}[${i}]`).toBe(theirs[i])
  }
}

/** Complex variant: `{re, im}` against upstream `[re[], im[]]`. */
export function expectComplexBitEqual(
  mine: { re: ArrayLike<number>; im: ArrayLike<number> },
  theirs: [ArrayLike<number | undefined>, ArrayLike<number | undefined>],
  label: string,
  allowTrailingNaN = false
): void {
  expectBitEqual(mine.re, theirs[0], `${label}.re`, allowTrailingNaN)
  expectBitEqual(mine.im, theirs[1], `${label}.im`, allowTrailingNaN)
}
