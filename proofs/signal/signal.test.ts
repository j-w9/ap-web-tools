// Reproductions for the Libraries (signal) rows of docs/upstream-bugs.md.
// Verdicts: docs/bug-proofs/signal.md.
import FFT from 'fft.js'
import { describe, expect, it } from 'vitest'
import { loadSignal } from './_harness.js'

const up = loadSignal()

/** Name and message of what `fn` throws (errors from the vm context are not this realm's classes). */
function thrown(fn: () => unknown): { name: string; message: string } | undefined {
  try {
    fn()
  } catch (e) {
    const { name, message } = e as Error
    return { name, message }
  }
  return undefined
}

const invalidLength = { name: 'RangeError', message: 'Invalid array length' }

describe('linear_interp leaves later queries unassigned after one NaN', () => {
  it('returns undefined for the in-range query after a NaN query', () => {
    const result = up.linear_interp([0, 10, 20], [0, 1, 2], [0.5, NaN, 1.5])
    expect(result).toEqual([5, undefined, undefined])
    // Never assigned (holes of `new Array(len)`), not computed as undefined.
    expect(1 in result).toBe(false)
    expect(2 in result).toBe(false)
  })

  it('a NaN in index makes the bracketing interpolations NaN', () => {
    expect(up.linear_interp([0, 10, 20], [0, NaN, 2], [0.5, 1.5])).toEqual([NaN, NaN])
  })

  it('relies on ascending queries: a query below the previous one is extrapolated from the later segment', () => {
    // Piecewise-linear interpolation of 0.5 on (0,0)-(1,10) is 5; after 1.5 the shared search index
    // has moved to the (1,10)-(2,30) segment, and 0.5 is extrapolated from it.
    expect(up.linear_interp([0, 10, 30], [0, 1, 2], [0.5])).toEqual([5])
    expect(up.linear_interp([0, 10, 30], [0, 1, 2], [1.5, 0.5])).toEqual([20, 0])
  })
})

describe('run_fft throws for data shorter than one window minus one spacing', () => {
  const window = up.hanning(64)
  const fft = new FFT(64)
  const data = (n: number) => ({ x: Array.from({ length: n }, (_, i) => i) })

  it('returns zero windows for 32 to 63 samples (window 64, spacing 32)', () => {
    for (const n of [32, 63]) {
      const res = up.run_fft(data(n), ['x'], 64, 32, window, fft)
      expect(res.center).toEqual([])
      expect(res.x).toEqual([])
    }
  })

  it('throws RangeError for 3 samples (window 64, spacing 32)', () => {
    expect(thrown(() => up.run_fft(data(3), ['x'], 64, 32, window, fft))).toEqual(invalidLength)
  })

  it('throws at 31 samples, the first length below window - spacing', () => {
    expect(thrown(() => up.run_fft(data(31), ['x'], 64, 32, window, fft))).toEqual(invalidLength)
  })
})

describe('array_from_range throws for a NaN length', () => {
  it('throws Invalid array length for a NaN end', () => {
    expect(thrown(() => up.array_from_range(0, NaN, 0.1))).toEqual(invalidLength)
  })
})
