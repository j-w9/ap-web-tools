// Test-only numeric comparison helpers.
import { expect } from 'vitest'

/**
 * Assert two numeric sequences are equal element-wise to within `tol` (absolute, scaled by
 * magnitude above 1). `tol = 0` demands bit-identical values (NaN equals NaN).
 */
export function expectArrayClose(
  actual: ArrayLike<number> | undefined,
  expected: ArrayLike<number> | undefined,
  label: string,
  tol = 0
): void {
  expect(actual, label).toBeDefined()
  expect(expected, label).toBeDefined()
  if (actual === undefined || expected === undefined) return
  expect(actual.length, `${label} length`).toBe(expected.length)
  for (let i = 0; i < actual.length; i++) {
    const a: number = actual[i]!
    const e: number = expected[i]!
    if (Number.isNaN(a) && Number.isNaN(e)) continue
    if (a === e) continue
    const err = Math.abs(a - e) / Math.max(1, Math.abs(e))
    if (!(err <= tol)) {
      expect.fail(`${label}[${i}]: ${a} != ${e} (rel err ${err}, tol ${tol})`)
    }
  }
}

/** Compare a `{re, im}` complex vector with an upstream `[re[], im[]]` pair. */
export function expectComplexClose(
  actual: { re: ArrayLike<number>; im: ArrayLike<number> },
  expected: [ArrayLike<number>, ArrayLike<number>],
  label: string,
  tol = 0
): void {
  expectArrayClose(actual.re, expected[0], `${label}.re`, tol)
  expectArrayClose(actual.im, expected[1], `${label}.im`, tol)
}
