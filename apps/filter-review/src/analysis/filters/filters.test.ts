import { describe, expect, it } from 'vitest'
import { arrayFromRange } from '@apwt/signal'
import { rng } from '../test-utils/rng.js'
import { expectComplexClose } from '../test-utils/compare.js'
import { loadFilterReviewUpstream, type Pair } from '../test-utils/upstream.js'
import { LowPassFilter } from './low-pass.js'
import { MultiNotch, NotchFilter } from './notch.js'
import { unitAccumulator, zGrid, type TransferAccumulator } from './z-grid.js'

const up = loadFilterReviewUpstream()
const freq = arrayFromRange(0, 1000, 0.37)

/** Run an upstream filter's transfer on unit Hn/Hd and return them. */
function upstreamTransfer(construct: string, call: string, rate: number): { num: Pair; den: Pair } {
  up.set('__freq', Array.from(freq))
  up.set('__rate', rate)
  return up.run(`(() => {
    const Z = exp_jw(__freq, __rate)
    const Z1 = complex_inverse(Z)
    const Z2 = complex_inverse(complex_square(Z))
    const n = __freq.length
    const Hn = [new Array(n).fill(1), new Array(n).fill(0)]
    const Hd = [new Array(n).fill(1), new Array(n).fill(0)]
    const f = ${construct}
    ${call}
    return { num: Hn, den: Hd }
  })()`) as { num: Pair; den: Pair }
}

function expectSame(mine: TransferAccumulator, theirs: { num: Pair; den: Pair }, label: string): void {
  expectComplexClose(mine.num, theirs.num, `${label} num`)
  expectComplexClose(mine.den, theirs.den, `${label} den`)
}

describe('LowPassFilter', () => {
  it.each([20, 45.5, 0, -1, 400])('matches upstream DigitalBiquadFilter at %d Hz', (cutoff) => {
    const rate = 2000
    const h = unitAccumulator(freq.length)
    new LowPassFilter(cutoff).transfer(h, rate, zGrid(freq, rate))
    expectSame(
      h,
      upstreamTransfer(`new DigitalBiquadFilter(${cutoff})`, 'f.transfer(Hn, Hd, __rate, Z1, Z2)', rate),
      `lp ${cutoff}`
    )
  })
})

describe('NotchFilter', () => {
  const next = rng(11)
  const cases = Array.from({ length: 25 }, () => ({
    att: 10 + 40 * next(),
    bw: 5 + 60 * next(),
    harmonic: 1 + Math.floor(next() * 4),
    minFreq: next() < 0.3 ? 0 : 20 + 80 * next(),
    spread: 0.9 + 0.2 * next(),
    center: 5 + 300 * next()
  }))
  it.each(cases)('matches upstream NotchFilter %#', (c) => {
    const rate = 1800 + 400 * next()
    const h = unitAccumulator(freq.length)
    new NotchFilter(c.att, c.bw, c.harmonic, () => c.minFreq, c.spread).transfer(h, c.center, rate, zGrid(freq, rate))
    const theirs = upstreamTransfer(
      `new NotchFilter(${c.att}, ${c.bw}, ${c.harmonic}, () => ${c.minFreq}, ${c.spread})`,
      `f.transfer(Hn, Hd, ${c.center}, __rate, Z1, Z2)`,
      rate
    )
    expectSame(h, theirs, 'notch')
  })
})

describe('MultiNotch', () => {
  it.each([2, 3, 5])('matches upstream with %d notches', (num) => {
    const rate = 2000
    const h = unitAccumulator(freq.length)
    new MultiNotch(35, 30, 2, (hm) => 15 * hm, num, 70).transfer(h, 90, rate, zGrid(freq, rate))
    const theirs = upstreamTransfer(
      `new MultiNotch(35, 30, 2, (hm) => 15 * hm, ${num}, 70)`,
      'f.transfer(Hn, Hd, 90, __rate, Z1, Z2)',
      rate
    )
    expectSame(h, theirs, `multi ${num}`)
  })

  it('reduces the response at the notch centre', () => {
    const rate = 2000
    const f = Float64Array.of(10, 100, 400)
    const h = unitAccumulator(f.length)
    new NotchFilter(40, 20, 1, () => 0, 1).transfer(h, 100, rate, zGrid(f, rate))
    const mag = (i: number): number => Math.hypot(h.num.re[i]!, h.num.im[i]!) / Math.hypot(h.den.re[i]!, h.den.im[i]!)
    expect(mag(1)).toBeCloseTo(0.01, 6)
    expect(mag(0)).toBeGreaterThan(0.99)
    expect(mag(2)).toBeGreaterThan(0.99)
  })
})
