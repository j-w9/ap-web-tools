import { describe, expect, it } from 'vitest'
import { binCentres, binCount, emptyTotal, totalCount } from './rates.js'
import { loadUpstream } from './test-support/upstream.js'
import { rng } from './test-support/random.js'

describe('binCount', () => {
  it('sums weights per bin and places points at bin centres', () => {
    const total = emptyTotal()
    const r = binCount([0.1, 0.2, 1.5, 3.9], [1, 2, 3, 4], 1, total)
    expect(r.rate).toEqual([3, 3, 0, 4])
    expect(r.time).toEqual([0.5, 1.5, 2.5, 3.5])
    expect(binCentres(2, 4, 0.5)).toEqual([1.25, 1.75, 2.25])
  })

  it('throws for an empty series, as upstream array_from_range does', () => {
    expect(() => binCount([], 1, 1, emptyTotal())).toThrow(RangeError)
    expect(totalCount(emptyTotal(), 1)).toBeNull()
  })
})

describe('rates against upstream bin_count / total_count', () => {
  const upstream = loadUpstream()
  const next = rng(7)

  // Negative and huge windows are accepted by upstream (the input's min is not enforced) and
  // give its odd results; they must match too.
  for (const width of [0.1, 0.7, 1, 2.5, 10, -1, -7.5, 1e6, Infinity]) {
    it(`matches with a ${width} s window`, () => {
      const upstreamTotal = { count: [] as number[], low_bin: Infinity, high_bin: -Infinity }
      const total = emptyTotal()
      for (let s = 0; s < 4; s++) {
        const start = s === 0 ? 0 : next() * 50
        const time = Array.from({ length: 300 }, (_, i) => start + i * next() * 0.3)
        time.sort((a, b) => a - b)
        const sizes = time.map(() => 8 * (12 + Math.floor(next() * 255)))
        const weight = s % 2 === 0 ? sizes : 1
        const expected = upstream.bin_count(time, weight, width, upstreamTotal)
        const rate = binCount(time, weight, width, total)
        expect(rate.time).toEqual(Array.from(expected.time))
        expect(rate.rate).toEqual(Array.from(expected.count))
      }
      const expectedTotal = upstream.total_count(upstreamTotal, width)
      const port = totalCount(total, width)
      if (expectedTotal.time === null) {
        expect(port).toBeNull()
      } else {
        expect(port?.time).toEqual(Array.from(expectedTotal.time))
        expect(port?.rate).toEqual(Array.from(expectedTotal.count ?? []))
      }
    })
  }

  it('leaves negative bins out of the total and has none when no bin is 0, as upstream', () => {
    const time = [1, 2, 3, 25]
    const upstreamTotal = { count: [] as number[], low_bin: Infinity, high_bin: -Infinity }
    upstream.bin_count(time, 1, -10, upstreamTotal)
    const total = emptyTotal()
    binCount(time, 1, -10, total)
    expect(upstream.total_count(upstreamTotal, -10).time).toBeNull()
    expect(totalCount(total, -10)).toBeNull()
  })

  for (const width of [0, Number.NaN]) {
    it(`throws like upstream for a ${width} s window`, () => {
      const time = [0, 0.5, 1.2]
      expect(() => upstream.bin_count(time, 1, width, { count: [], low_bin: Infinity, high_bin: -Infinity })).toThrow(
        'Invalid array length'
      )
      expect(() => binCount(time, 1, width, emptyTotal())).toThrow(RangeError)
      expect(() => binCount([0.5, 1.2], 1, width, emptyTotal())).toThrow(RangeError)
    })
  }
})
