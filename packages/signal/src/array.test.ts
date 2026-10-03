import { describe, expect, it } from 'vitest'
import {
  arrayAbs,
  arrayAdd,
  arrayAllEqual,
  arrayAllNaN,
  arrayDiv,
  arrayFromRange,
  arrayInverse,
  arrayLog10,
  arrayMax,
  arrayMean,
  arrayMin,
  arrayMul,
  arrayOffset,
  arrayScale,
  arraySqrt,
  arraySub,
  arraySum,
  linearInterp
} from './array.js'
import { loadUpstream, randomArray, rng } from './test-utils/upstream.js'

const up = loadUpstream()

describe('array helpers (hand-computed)', () => {
  it('element-wise binary ops', () => {
    expect(Array.from(arrayMax([1, 5], [3, 2]))).toEqual([3, 5])
    expect(Array.from(arrayMin([1, 5], [3, 2]))).toEqual([1, 2])
    expect(Array.from(arrayMul([2, 3], [4, 5]))).toEqual([8, 15])
    expect(Array.from(arrayDiv([8, 3], [4, 2]))).toEqual([2, 1.5])
    expect(Array.from(arrayAdd([1, 2], [3, 4]))).toEqual([4, 6])
    expect(Array.from(arraySub([1, 2], [3, 4]))).toEqual([-2, -2])
  })

  it('element-wise unary ops', () => {
    expect(Array.from(arrayScale([1, -2], 3))).toEqual([3, -6])
    expect(Array.from(arrayInverse([2, 4]))).toEqual([0.5, 0.25])
    expect(Array.from(arrayOffset([1, 2], 10))).toEqual([11, 12])
    expect(Array.from(arrayLog10([1, 100]))).toEqual([0, 2])
    expect(Array.from(arrayAbs([-1, 2]))).toEqual([1, 2])
    expect(Array.from(arraySqrt([4, 9]))).toEqual([2, 3])
  })

  it('accepts typed arrays as input', () => {
    expect(Array.from(arrayAdd(new Float32Array([1, 2]), new Float64Array([3, 4])))).toEqual([4, 6])
  })

  it('reductions and predicates', () => {
    expect(arraySum([1, 2, 3.5])).toBe(6.5)
    expect(arrayMean([1, 2, 3])).toBe(2)
    expect(arrayMean([])).toBeNaN()
    expect(arrayAllEqual([2, 2, 2], 2)).toBe(true)
    expect(arrayAllEqual([2, 3], 2)).toBe(false)
    expect(arrayAllEqual([], 7)).toBe(true)
    expect(arrayAllNaN([NaN, NaN])).toBe(true)
    expect(arrayAllNaN([NaN, 1])).toBe(false)
  })

  it('arrayFromRange is inclusive of both ends', () => {
    expect(Array.from(arrayFromRange(0, 1, 0.25))).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(Array.from(arrayFromRange(5, 20, 5))).toEqual([5, 10, 15, 20])
  })

  it('linearInterp interpolates and clamps', () => {
    const r = linearInterp([0, 10, 20], [0, 1, 2], [-1, 0.5, 1.25, 2, 3])
    expect(Array.from(r)).toEqual([0, 5, 12.5, 20, 20])
  })
})

describe('array helper edge cases match upstream', () => {
  // Upstream leaves unassigned elements as holes (`undefined`); the typed-array port stores NaN.
  const asNaN = (a: readonly (number | undefined)[]): number[] => Array.from(a, (v) => v ?? NaN)

  it('linearInterp with NaN queries, NaN index values and an empty index', () => {
    const cases: [number[], number[], number[]][] = [
      [
        [0, 10, 20],
        [0, 1, 2],
        [0.5, NaN, 1.5]
      ],
      [
        [0, 10, 20, 30],
        [0, NaN, 2, 3],
        [0.5, 1.5, 2.5]
      ],
      [[], [], [0, 1]],
      [[5], [1], [0, 1, 2]],
      [
        [0, 10, 20],
        [0, 1, 2],
        [1.5, 0.5, 1.75]
      ]
    ]
    for (const [values, index, query] of cases) {
      expect(Array.from(linearInterp(values, index, query))).toEqual(asNaN(up.linear_interp(values, index, query)))
    }
  })

  it('arrayFromRange throws for NaN, negative and infinite lengths, as upstream', () => {
    for (const [start, end, step] of [
      [NaN, 1, 0.1],
      [0, NaN, 0.1],
      [0, 1, NaN],
      [0, -5, 1],
      [0, 1, 0]
    ] as const) {
      expect(() => up.array_from_range(start, end, step)).toThrow('Invalid array length')
      expect(() => arrayFromRange(start, end, step)).toThrow(RangeError)
    }
    expect(Array.from(arrayFromRange(0, -0.5, 1))).toEqual(up.array_from_range(0, -0.5, 1))
  })

  it('arrayAllEqual / arrayAllNaN on numeric edge values', () => {
    for (const a of [[], [NaN], [0, -0], [NaN, 1], [Infinity, Infinity]]) {
      expect(arrayAllNaN(a)).toBe(up.array_all_NaN(a))
      expect(arrayAllEqual(a, 0)).toBe(up.array_all_equal(a, 0))
      expect(arrayAllEqual(a, Infinity)).toBe(up.array_all_equal(a, Infinity))
    }
  })
})

describe('array helpers match upstream bit-for-bit on random inputs', () => {
  const next = rng(99)
  for (let trial = 0; trial < 5; trial++) {
    const n = 1 + Math.floor(next() * 50)
    const A = randomArray(next, n)
    const B = randomArray(next, n)
    const P = randomArray(next, n, 0.01, 100)
    const s = next() * 10 - 5

    it(`trial ${trial} (n=${n})`, () => {
      expect(Array.from(arrayMax(A, B))).toEqual(up.array_max(A, B))
      expect(Array.from(arrayMin(A, B))).toEqual(up.array_min(A, B))
      expect(Array.from(arrayScale(A, s))).toEqual(up.array_scale(A, s))
      expect(Array.from(arrayInverse(A))).toEqual(up.array_inverse(A))
      expect(Array.from(arrayMul(A, B))).toEqual(up.array_mul(A, B))
      expect(Array.from(arrayDiv(A, B))).toEqual(up.array_div(A, B))
      expect(Array.from(arrayOffset(A, s))).toEqual(up.array_offset(A, s))
      expect(Array.from(arrayAdd(A, B))).toEqual(up.array_add(A, B))
      expect(Array.from(arraySub(A, B))).toEqual(up.array_sub(A, B))
      expect(Array.from(arrayLog10(P))).toEqual(up.array_log10(P))
      expect(Array.from(arrayAbs(A))).toEqual(up.array_abs(A))
      expect(Array.from(arraySqrt(P))).toEqual(up.array_sqrt(P))
      expect(arraySum(A)).toBe(up.array_sum(A))
      expect(arrayMean(A)).toBe(up.array_mean(A))
      expect(arrayAllEqual(A, A[0]!)).toBe(up.array_all_equal(A, A[0]!))
      expect(arrayAllNaN(A)).toBe(up.array_all_NaN(A))
      const step = 0.1 + next()
      const end = step * (1 + next() * 40)
      expect(Array.from(arrayFromRange(0, end, step))).toEqual(up.array_from_range(0, end, step))
      const index = Array.from({ length: n }, (_, i) => i * 0.5)
      const query = randomArray(next, 30, -1, n).sort((x, y) => x - y)
      expect(Array.from(linearInterp(A, index, query))).toEqual(up.linear_interp(A, index, query))
    })
  }
})
