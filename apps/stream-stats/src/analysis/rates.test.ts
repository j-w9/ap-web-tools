import { describe, expect, it } from 'vitest'
import { binCentres, binSums, seriesRate, sumBins, totalRate } from './rates.js'
import { loadUpstream } from './test-support/upstream.js'
import { rng } from './test-support/random.js'

describe('binSums', () => {
  it('sums weights per bin', () => {
    const b = binSums([0.1, 0.2, 1.5, 3.9], [1, 2, 3, 4], 1)
    expect(b?.lowBin).toBe(0)
    expect(Array.from(b?.sums ?? [])).toEqual([3, 3, 0, 4])
    expect(binSums([], 1, 1)).toBeNull()
  })

  it('places points at bin centres', () => {
    expect(Array.from(binCentres(2, 3, 0.5))).toEqual([1.25, 1.75, 2.25])
  })

  it('sums series bin-wise over the union of their spans', () => {
    const total = sumBins([
      { lowBin: 2, sums: Float64Array.of(1, 1) },
      { lowBin: 5, sums: Float64Array.of(4) }
    ])
    expect(total?.lowBin).toBe(2)
    expect(Array.from(total?.sums ?? [])).toEqual([1, 1, 0, 4])
    expect(sumBins([])).toBeNull()
    expect(totalRate([], 1)).toBeNull()
  })
})

describe('rates against upstream bin_count / total_count', () => {
  const upstream = loadUpstream()
  const next = rng(7)

  for (const width of [0.1, 0.7, 1, 2.5, 10]) {
    it(`matches with a ${width} s window`, () => {
      const upstreamTotal = { count: [] as number[], low_bin: Infinity, high_bin: -Infinity }
      const binned = []
      for (let s = 0; s < 4; s++) {
        const start = next() * 50
        const time = Array.from({ length: 300 }, (_, i) => start + i * next() * 0.3)
        time.sort((a, b) => a - b)
        const sizes = time.map(() => 8 * (12 + Math.floor(next() * 255)))
        const weight = s % 2 === 0 ? sizes : 1
        const expected = upstream.bin_count(time, weight, width, upstreamTotal)
        const sums = binSums(time, weight, width)
        if (sums === null) throw new Error('empty')
        binned.push(sums)
        const rate = seriesRate(sums, width)
        expect(Array.from(rate.time)).toEqual(Array.from(expected.time))
        expect(Array.from(rate.rate)).toEqual(Array.from(expected.count))
      }
      const expectedTotal = upstream.total_count(upstreamTotal, width)
      const total = totalRate(binned, width)
      expect(Array.from(total?.time ?? [])).toEqual(Array.from(expectedTotal.time ?? []))
      expect(Array.from(total?.rate ?? [])).toEqual(Array.from(expectedTotal.count ?? []))
    })
  }
})
