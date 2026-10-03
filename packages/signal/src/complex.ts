// Complex-number helpers ported from upstream/Libraries/Array_Math.js.
//
// Upstream stores a vector of complex numbers as a pair of parallel arrays
// `[re[], im[]]`. That is the shape every consumer (FilterTool, FilterReview,
// PIDReview step response) actually does its maths in, so the vector form
// `ComplexArray` is the primary API here; the scalar `Complex` type is offered
// for element access and construction.

/** A single complex number. */
export interface Complex {
  readonly re: number
  readonly im: number
}

/** Read-only view of a vector of complex numbers as parallel real/imaginary arrays. */
export interface ComplexArrayLike {
  readonly re: ArrayLike<number>
  readonly im: ArrayLike<number>
}

/** A freshly allocated vector of complex numbers (parallel real/imaginary arrays). */
export interface ComplexArray {
  re: Float64Array
  im: Float64Array
}

/** Allocate a zero-filled complex vector of the given length. */
export function complexArrayOf(length: number): ComplexArray {
  return { re: new Float64Array(length), im: new Float64Array(length) }
}

/** Build a complex vector from a list of scalar complex numbers. */
export function complexArrayFrom(values: readonly Complex[]): ComplexArray {
  const out = complexArrayOf(values.length)
  for (let i = 0; i < values.length; i++) {
    out.re[i] = values[i]!.re
    out.im[i] = values[i]!.im
  }
  return out
}

/** Copy a complex vector (any array-like parts) into fresh Float64Arrays. */
export function complexArrayCopy(c: ComplexArrayLike): ComplexArray {
  return { re: Float64Array.from(c.re), im: Float64Array.from(c.im) }
}

/** Read element `i` of a complex vector as a scalar `Complex`. */
export function complexAt(c: ComplexArrayLike, i: number): Complex {
  return { re: c.re[i]!, im: c.im[i]! }
}

/** Element-wise complex product a[i] * b[i]. */
export function complexMul(a: ComplexArrayLike, b: ComplexArrayLike): ComplexArray {
  const len = a.re.length
  const out = complexArrayOf(len)
  for (let i = 0; i < len; i++) {
    const ac = a.re[i]! * b.re[i]!
    const bd = a.im[i]! * b.im[i]!
    const ad = a.re[i]! * b.im[i]!
    const bc = a.im[i]! * b.re[i]!
    out.re[i] = ac - bd
    out.im[i] = ad + bc
  }
  return out
}

/** Element-wise complex quotient a[i] / b[i]. */
export function complexDiv(a: ComplexArrayLike, b: ComplexArrayLike): ComplexArray {
  const len = a.re.length
  const out = complexArrayOf(len)
  for (let i = 0; i < len; i++) {
    const ac = a.re[i]! * b.re[i]!
    const bd = a.im[i]! * b.im[i]!
    const ad = a.re[i]! * b.im[i]!
    const bc = a.im[i]! * b.re[i]!
    const denominator = 1 / (b.re[i]! ** 2 + b.im[i]! ** 2)
    out.re[i] = (ac + bd) * denominator
    out.im[i] = (bc - ad) * denominator
  }
  return out
}

/** Element-wise magnitude |c[i]| = sqrt(re^2 + im^2). */
export function complexAbs(c: ComplexArrayLike): Float64Array {
  const len = c.re.length
  const out = new Float64Array(len)
  for (let i = 0; i < len; i++) {
    out[i] = (c.re[i]! ** 2 + c.im[i]! ** 2) ** 0.5
  }
  return out
}

/** Element-wise reciprocal 1 / c[i]. */
export function complexInverse(c: ComplexArrayLike): ComplexArray {
  const len = c.re.length
  const out = complexArrayOf(len)
  for (let i = 0; i < len; i++) {
    const denominator = 1 / (c.re[i]! ** 2 + c.im[i]! ** 2)
    out.re[i] = c.re[i]! * denominator
    out.im[i] = c.im[i]! * -denominator
  }
  return out
}

/** Element-wise square c[i]^2. */
export function complexSquare(c: ComplexArrayLike): ComplexArray {
  const len = c.re.length
  const out = complexArrayOf(len)
  for (let i = 0; i < len; i++) {
    out.re[i] = c.re[i]! ** 2 - c.im[i]! ** 2
    out.im[i] = c.re[i]! * c.im[i]! * 2
  }
  return out
}

/** Element-wise phase angle atan2(im, re), in radians. */
export function complexPhase(c: ComplexArrayLike): Float64Array {
  const len = c.re.length
  const out = new Float64Array(len)
  for (let i = 0; i < len; i++) {
    out[i] = Math.atan2(c.im[i]!, c.re[i]!)
  }
  return out
}

/** Element-wise complex conjugate (re, -im). */
export function complexConj(c: ComplexArrayLike): ComplexArray {
  const len = c.re.length
  const out = complexArrayOf(len)
  for (let i = 0; i < len; i++) {
    out.re[i] = c.re[i]!
    out.im[i] = c.im[i]! * -1
  }
  return out
}

/** Unit phasors e^(j*2*pi*f/rate) for each frequency f (Hz) at the given sample rate (Hz). */
export function expJw(freq: ArrayLike<number>, rate: number): ComplexArray {
  const scale = (2 * Math.PI) / rate
  const len = freq.length
  const out = complexArrayOf(len)
  for (let i = 0; i < len; i++) {
    const jw = freq[i]! * scale
    out.re[i] = Math.cos(jw)
    out.im[i] = Math.sin(jw)
  }
  return out
}
