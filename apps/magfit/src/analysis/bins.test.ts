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

  it('matches upstream find_start_index and find_end_index', () => {
    const time = [1, 2, 3, 4, 5, 6.5, 7, 8]
    for (const t of [0, 1, 1.5, 3, 4.2, 7, 8, 9]) {
      up.element('TimeStart')['value'] = String(t)
      up.element('TimeEnd')['value'] = String(t)
      expect(findStartIndex(time, t), `start ${t}`).toBe(up.evaluate(`find_start_index(${JSON.stringify(time)})`))
      expect(findEndIndex(time, t), `end ${t}`).toBe(up.evaluate(`find_end_index(${JSON.stringify(time)})`))
    }
    expect(analysisRange(time, 0, 100)).toEqual({ start: 0, end: 8 })
    expect(analysisRange(time, 3, 5)).toEqual({ start: 1, end: 6 })
  })
})
