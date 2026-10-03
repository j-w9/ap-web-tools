import { describe, expect, it } from 'vitest'
import {
  complexAbs,
  complexArrayFrom,
  complexAt,
  complexConj,
  complexDiv,
  complexInverse,
  complexMul,
  complexPhase,
  complexSquare,
  expJw
} from './complex.js'
import { fromPair, loadUpstream, randomArray, rng, toPair } from './test-utils/upstream.js'

const up = loadUpstream()

describe('complex scalar / construction helpers', () => {
  it('round-trips scalar values through a ComplexArray', () => {
    const c = complexArrayFrom([
      { re: 1, im: 2 },
      { re: -3, im: 0.5 }
    ])
    expect(Array.from(c.re)).toEqual([1, -3])
    expect(Array.from(c.im)).toEqual([2, 0.5])
    expect(complexAt(c, 1)).toEqual({ re: -3, im: 0.5 })
  })
})

describe('complex vector maths (hand-computed)', () => {
  const a = complexArrayFrom([
    { re: 1, im: 2 },
    { re: 3, im: -1 }
  ])
  const b = complexArrayFrom([
    { re: 2, im: -1 },
    { re: 0, im: 2 }
  ])

  it('complexMul', () => {
    // (1+2j)(2-j) = 4+3j ; (3-j)(2j) = 2+6j
    const r = complexMul(a, b)
    expect(Array.from(r.re)).toEqual([4, 2])
    expect(Array.from(r.im)).toEqual([3, 6])
  })

  it('complexDiv', () => {
    // (1+2j)/(2-j) = j ; (3-j)/(2j) = -0.5-1.5j
    const r = complexDiv(a, b)
    expect(Array.from(r.re)).toEqual([0, -0.5])
    expect(Array.from(r.im)).toEqual([1, -1.5])
  })

  it('complexAbs / complexPhase', () => {
    const r = complexAbs(
      complexArrayFrom([
        { re: 3, im: 4 },
        { re: 0, im: -2 }
      ])
    )
    expect(Array.from(r)).toEqual([5, 2])
    const p = complexPhase(
      complexArrayFrom([
        { re: 1, im: 1 },
        { re: -1, im: 0 }
      ])
    )
    expect(p[0]).toBeCloseTo(Math.PI / 4, 15)
    expect(p[1]).toBeCloseTo(Math.PI, 15)
  })

  it('complexInverse / complexSquare / complexConj', () => {
    const inv = complexInverse(complexArrayFrom([{ re: 0, im: 2 }]))
    expect(Array.from(inv.re)).toEqual([0])
    expect(Array.from(inv.im)).toEqual([-0.5])
    const sq = complexSquare(complexArrayFrom([{ re: 1, im: 2 }]))
    expect(Array.from(sq.re)).toEqual([-3])
    expect(Array.from(sq.im)).toEqual([4])
    const cj = complexConj(a)
    expect(Array.from(cj.re)).toEqual([1, 3])
    expect(Array.from(cj.im)).toEqual([-2, 1])
  })

  it('expJw gives unit phasors at the expected angles', () => {
    const z = expJw([0, 100, 200], 400) // 0, pi/2, pi
    expect(z.re[0]).toBe(1)
    expect(z.im[0]).toBe(0)
    expect(z.re[1]).toBeCloseTo(0, 15)
    expect(z.im[1]).toBeCloseTo(1, 15)
    expect(z.re[2]).toBeCloseTo(-1, 15)
  })
})

describe('complex vector maths matches upstream bit-for-bit on random inputs', () => {
  const next = rng(1234)
  for (let trial = 0; trial < 5; trial++) {
    const n = 1 + Math.floor(next() * 64)
    const A: [number[], number[]] = [randomArray(next, n), randomArray(next, n)]
    const B: [number[], number[]] = [randomArray(next, n), randomArray(next, n)]
    const a = fromPair(A)
    const b = fromPair(B)

    it(`trial ${trial} (n=${n})`, () => {
      expect(toPair(complexMul(a, b))).toEqual(up.complex_mul(A, B))
      expect(toPair(complexDiv(a, b))).toEqual(up.complex_div(A, B))
      expect(Array.from(complexAbs(a))).toEqual(up.complex_abs(A))
      expect(toPair(complexInverse(a))).toEqual(up.complex_inverse(A))
      expect(toPair(complexSquare(a))).toEqual(up.complex_square(A))
      expect(Array.from(complexPhase(a))).toEqual(up.complex_phase(A))
      expect(toPair(complexConj(a))).toEqual(up.complex_conj(A))
      const freq = randomArray(next, n, 0, 500)
      expect(toPair(expJw(freq, 1000))).toEqual(up.exp_jw(freq, 1000))
    })
  }
})
