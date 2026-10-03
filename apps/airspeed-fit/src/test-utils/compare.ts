// Test-only comparison helpers for oracle tests.
import { expect } from 'vitest'

/** Assert two numeric arrays are identical element for element (NaN equals NaN). */
export function expectSameArray(mine: ArrayLike<number> | undefined, theirs: ArrayLike<number> | undefined, label: string): void {
  expect(mine, label).toBeDefined()
  expect(theirs, label).toBeDefined()
  if (mine === undefined || theirs === undefined) return
  expect(mine.length, `${label} length`).toBe(theirs.length)
  for (let i = 0; i < mine.length; i++) {
    const a = mine[i]
    const b = theirs[i]
    if (!Object.is(a, b) && !(a === b) && !(Number.isNaN(a) && Number.isNaN(b))) {
      expect(a, `${label}[${i}]`).toBe(b)
    }
  }
}

/** Assert two numbers are identical (NaN equals NaN, undefined matches NaN). */
export function expectSameNumber(mine: number, theirs: number | undefined | null, label: string): void {
  if (theirs === undefined || theirs === null) {
    expect(mine, label).toBeNaN()
    return
  }
  if (Number.isNaN(mine) && Number.isNaN(theirs)) return
  expect(mine, label).toBe(theirs)
}
