import { complexInverse, complexSquare, expJw, type ComplexArray } from '@apwt/signal'

/** Delay operators z^-1 and z^-2 evaluated on a frequency grid. */
export interface ZGrid {
  /** z^-1 at each frequency. */
  readonly z1: ComplexArray
  /** z^-2 at each frequency. */
  readonly z2: ComplexArray
}

/** z^-1 and z^-2 for `freq` (Hz) at `sampleRate` (Hz), computed exactly as upstream `calculate()`. */
export function zGrid(freq: ArrayLike<number>, sampleRate: number): ZGrid {
  // Z = e^jw
  const z = expJw(freq, sampleRate)
  return { z1: complexInverse(z), z2: complexInverse(complexSquare(z)) }
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

/**
 * Multiply `h` by the biquad H(z) = (b0 + b1 z^-1 + b2 z^-2) / (a0 + a1 z^-1 + a2 z^-2),
 * keeping numerator and denominator separate (division happens once at the end). The
 * arithmetic is written out exactly as upstream so results match bit-for-bit.
 */
export function applyBiquad(
  h: TransferAccumulator,
  grid: ZGrid,
  b0: number,
  b1: number,
  b2: number,
  a0: number,
  a1: number,
  a2: number
): void {
  const { num, den } = h
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
