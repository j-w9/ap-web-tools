/**
 * Biquad sections H(z) = (b0 + b1 z^-1 + b2 z^-2) / (a0 + a1 z^-1 + a2 z^-2), evaluated two ways
 * that upstream tools use and that round differently, so both are kept:
 *
 * - {@link biquadResponse}: each section divided out on its own and the sections multiplied
 *   (FilterTool, AnalyticTune).
 * - {@link accumulateBiquad}: numerators and denominators multiplied up separately in a
 *   {@link TransferAccumulator}, divided once at the end (FilterReview).
 */
import { complexArrayOf, complexDiv, type ComplexArray } from '@apwt/signal'
import type { ZGrid } from './z-grid.js'

/** Biquad coefficients. */
export interface Biquad {
  readonly b0: number
  readonly b1: number
  readonly b2: number
  readonly a0: number
  readonly a1: number
  readonly a2: number
}

/** Response of one biquad on a grid. */
export function biquadResponse(c: Biquad, grid: ZGrid): ComplexArray {
  const { z1, z2 } = grid
  const len = z1.re.length
  const numerator = complexArrayOf(len)
  const denominator = complexArrayOf(len)
  for (let i = 0; i < len; i++) {
    numerator.re[i] = c.b0 + c.b1 * z1.re[i]! + c.b2 * z2.re[i]!
    numerator.im[i] = c.b1 * z1.im[i]! + c.b2 * z2.im[i]!

    denominator.re[i] = c.a0 + c.a1 * z1.re[i]! + c.a2 * z2.re[i]!
    denominator.im[i] = c.a1 * z1.im[i]! + c.a2 * z2.im[i]!
  }
  return complexDiv(numerator, denominator)
}

/** Numerator and denominator of a transfer function, accumulated in place. */
export interface TransferAccumulator {
  readonly num: ComplexArray
  readonly den: ComplexArray
}

/** A transfer accumulator of all ones (no filtering) of length `n`. */
export function unitAccumulator(n: number): TransferAccumulator {
  const ones = (): ComplexArray => ({ re: new Float64Array(n).fill(1), im: new Float64Array(n) })
  return { num: ones(), den: ones() }
}

/** Independent copy of an accumulator. */
export function copyAccumulator(h: TransferAccumulator): TransferAccumulator {
  return {
    num: { re: h.num.re.slice(), im: h.num.im.slice() },
    den: { re: h.den.re.slice(), im: h.den.im.slice() }
  }
}

/** The accumulated transfer function, num / den. */
export function accumulatorResponse(h: TransferAccumulator): ComplexArray {
  return complexDiv(h.num, h.den)
}

/**
 * Multiply `h` by a biquad, keeping numerator and denominator separate. The complex products are
 * written out exactly as upstream FilterReview so results match bit for bit.
 */
export function accumulateBiquad(h: TransferAccumulator, grid: ZGrid, c: Biquad): void {
  const { num, den } = h
  const { b0, b1, b2, a0, a1, a2 } = c
  const z1r = grid.z1.re
  const z1i = grid.z1.im
  const z2r = grid.z2.re
  const z2i = grid.z2.im
  const len = z1r.length
  for (let i = 0; i < len; i++) {
    const numeratorR = b0 + b1 * z1r[i]! + b2 * z2r[i]!
    const numeratorI = b1 * z1i[i]! + b2 * z2i[i]!

    const denominatorR = a0 + a1 * z1r[i]! + a2 * z2r[i]!
    const denominatorI = a1 * z1i[i]! + a2 * z2i[i]!

    const numAc = num.re[i]! * numeratorR
    const numBd = num.im[i]! * numeratorI
    const numAd = num.re[i]! * numeratorI
    const numBc = num.im[i]! * numeratorR
    num.re[i] = numAc - numBd
    num.im[i] = numAd + numBc

    const denAc = den.re[i]! * denominatorR
    const denBd = den.im[i]! * denominatorI
    const denAd = den.re[i]! * denominatorI
    const denBc = den.im[i]! * denominatorR
    den.re[i] = denAc - denBd
    den.im[i] = denAd + denBc
  }
}
