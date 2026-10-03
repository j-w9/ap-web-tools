import { beforeAll, describe, expect, it } from 'vitest'
import { expectSameArray, expectSameNumber } from '../test-utils/compare.js'
import { rng } from '../test-utils/synthetic-mag-log.js'
import { createUpstreamMagfit, type UpstreamMagfit } from '../test-utils/upstream.js'
import { NUM_BINS, assignBins, binWeights, fibonacciLattice } from './bins.js'
import { analysisRange, findEndIndex, findStartIndex } from './time-range.js'

describe('bins and time range', () => {
  let up: UpstreamMagfit
  beforeAll(async () => {
    up = await createUpstreamMagfit()
  })

  it('puts the lattice on the unit sphere', () => {
    const l = fibonacciLattice()
    expect(l.x.length).toBe(NUM_BINS)
    for (let i = 0; i < NUM_BINS; i++) expect(Math.hypot(l.x[i]!, l.y[i]!, l.z[i]!)).toBeCloseTo(1, 12)
  })

  it('assigns each direction to its own lattice point', () => {
    const l = fibonacciLattice()
    const scaled = { x: l.x.map((v) => v * 500), y: l.y.map((v) => v * 500), z: l.z.map((v) => v * 500) }
    expect(Array.from(assignBins(scaled))).toEqual(Array.from({ length: NUM_BINS }, (_, i) => i))
  })

  it('matches upstream get_weights', () => {
    const next = rng(5)
    for (const n of [1, 10, 500]) {
      const bins = Array.from({ length: n }, () => Math.floor(next() * 30))
      const theirs = up.evaluate<{ weights: number[]; coverage: number }>(`get_weights(${JSON.stringify(bins)})`)
      const mine = binWeights(bins)
      expectSameArray(mine.weights, theirs.weights, `weights ${n}`)
      expectSameNumber(mine.coverage, theirs.coverage, `coverage ${n}`)
    }
  })

  it('matches upstream get_weights for samples without a bin', () => {
    // A NaN expected field matches no bin: upstream leaves it undefined, the port uses -1.
    for (const bins of [
      [0, -1, 3, 3, -1],
      [-1, -1],
      [5, -1]
    ]) {
      const js = '[' + bins.map((b) => (b < 0 ? 'undefined' : String(b))).join(',') + ']'
      const theirs = up.evaluate<{ weights: number[]; coverage: number }>(`get_weights(${js})`)
      const mine = binWeights(bins)
      expectSameArray(mine.weights, theirs.weights, `weights ${js}`)
      expectSameNumber(mine.coverage, theirs.coverage, `coverage ${js}`)
    }
    const nan = Float64Array.of(NaN)
    expect(Array.from(assignBins({ x: nan, y: nan, z: nan }))).toEqual([-1])
  })

  it('matches upstream find_start_index and find_end_index', () => {
    const time = [1, 2, 3, 4, 5, 6.5, 7, 8]
    for (const t of [0, 1, 1.5, 3, 4.2, 7, 8, 9]) {
      up.element('TimeStart')['value'] = String(t)
      up.element('TimeEnd')['value'] = String(t)
      expect(findStartIndex(time, t), `start ${t}`).toBe(up.evaluate(`find_start_index(${JSON.stringify(time)})`))
      expect(findEndIndex(time, t), `end ${t}`).toBe(up.evaluate(`find_end_index(${JSON.stringify(time)})`))
    }
    // An empty time input parses to NaN upstream.
    up.element('TimeStart')['value'] = ''
    up.element('TimeEnd')['value'] = ''
    expect(findStartIndex(time, NaN)).toBe(up.evaluate(`find_start_index(${JSON.stringify(time)})`))
    expect(findEndIndex(time, NaN)).toBe(up.evaluate(`find_end_index(${JSON.stringify(time)})`))
    expect(analysisRange(time, 0, 100)).toEqual({ start: 0, end: 8 })
    expect(analysisRange(time, 3, 5)).toEqual({ start: 1, end: 6 })
  })
})
