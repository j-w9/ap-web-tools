// Element-wise array helpers ported from upstream/Libraries/Array_Math.js.
// All functions accept any `ArrayLike<number>` (plain or typed arrays) and
// return a new Float64Array; inputs are never mutated. Binary operations use
// the length of the first operand, exactly as upstream does.

/** Element-wise maximum max(a[i], b[i]). */
export function arrayMax(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const len = a.length
  const out = new Float64Array(len)
  for (let i = 0; i < len; i++) out[i] = Math.max(a[i]!, b[i]!)
  return out
}

/** Element-wise minimum min(a[i], b[i]). */
export function arrayMin(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const len = a.length
  const out = new Float64Array(len)
  for (let i = 0; i < len; i++) out[i] = Math.min(a[i]!, b[i]!)
  return out
}

/** Multiply every element by a scalar: a[i] * scale. */
export function arrayScale(a: ArrayLike<number>, scale: number): Float64Array {
  const len = a.length
  const out = new Float64Array(len)
  for (let i = 0; i < len; i++) out[i] = a[i]! * scale
  return out
}

/** Element-wise reciprocal 1 / a[i]. */
export function arrayInverse(a: ArrayLike<number>): Float64Array {
  const len = a.length
  const out = new Float64Array(len)
  for (let i = 0; i < len; i++) out[i] = 1 / a[i]!
  return out
}

/** Element-wise product a[i] * b[i]. */
export function arrayMul(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const len = a.length
  const out = new Float64Array(len)
  for (let i = 0; i < len; i++) out[i] = a[i]! * b[i]!
  return out
}

/** Element-wise quotient a[i] / b[i]. */
export function arrayDiv(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const len = a.length
  const out = new Float64Array(len)
  for (let i = 0; i < len; i++) out[i] = a[i]! / b[i]!
  return out
}

/** Add a scalar to every element: a[i] + offset. */
export function arrayOffset(a: ArrayLike<number>, offset: number): Float64Array {
  const len = a.length
  const out = new Float64Array(len)
  for (let i = 0; i < len; i++) out[i] = a[i]! + offset
  return out
}

/** Element-wise sum a[i] + b[i]. */
export function arrayAdd(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const len = a.length
  const out = new Float64Array(len)
  for (let i = 0; i < len; i++) out[i] = a[i]! + b[i]!
  return out
}

/** Element-wise difference a[i] - b[i]. */
export function arraySub(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const len = a.length
  const out = new Float64Array(len)
  for (let i = 0; i < len; i++) out[i] = a[i]! - b[i]!
  return out
}

/** Element-wise base-10 logarithm log10(a[i]). */
export function arrayLog10(a: ArrayLike<number>): Float64Array {
  const len = a.length
  const out = new Float64Array(len)
  for (let i = 0; i < len; i++) out[i] = Math.log10(a[i]!)
  return out
}

/** Element-wise absolute value |a[i]|. */
export function arrayAbs(a: ArrayLike<number>): Float64Array {
  const len = a.length
  const out = new Float64Array(len)
  for (let i = 0; i < len; i++) out[i] = Math.abs(a[i]!)
  return out
}

/** Element-wise square root sqrt(a[i]). */
export function arraySqrt(a: ArrayLike<number>): Float64Array {
  const len = a.length
  const out = new Float64Array(len)
  for (let i = 0; i < len; i++) out[i] = Math.sqrt(a[i]!)
  return out
}

/** True when every element equals `value` (NaN never matches). */
export function arrayAllEqual(a: ArrayLike<number>, value: number): boolean {
  const len = a.length
  for (let i = 0; i < len; i++) {
    if (a[i] !== value) return false
  }
  return true
}

/** True when every element is NaN (also true for an empty array). */
export function arrayAllNaN(a: ArrayLike<number>): boolean {
  const len = a.length
  for (let i = 0; i < len; i++) {
    if (!Number.isNaN(a[i])) return false
  }
  return true
}

/** Sum of all elements, accumulated left to right. */
export function arraySum(a: ArrayLike<number>): number {
  const len = a.length
  let sum = 0
  for (let i = 0; i < len; i++) sum += a[i]!
  return sum
}

/** Arithmetic mean of all elements (NaN for an empty array). */
export function arrayMean(a: ArrayLike<number>): number {
  return arraySum(a) / a.length
}

/**
 * Inclusive range start..end in increments of step, e.g. (0, 1, 0.25) -> [0, 0.25, 0.5, 0.75, 1].
 * Values are produced by repeated addition (as upstream) so they match upstream bit-for-bit.
 */
export function arrayFromRange(start: number, end: number, step: number): Float64Array {
  const len = Math.floor((end - start) / step) + 1
  const out = new Float64Array(len)
  let value = start
  for (let i = 0; i < len; i++) {
    out[i] = value
    value += step
  }
  return out
}

/**
 * Piecewise-linear interpolation of `values` sampled at ascending `index`, evaluated at each
 * `queryIndex`. Queries are clamped to the end values; `queryIndex` must itself be ascending.
 */
export function linearInterp(values: ArrayLike<number>, index: ArrayLike<number>, queryIndex: ArrayLike<number>): Float64Array {
  const len = queryIndex.length
  const out = new Float64Array(len)
  const lastValueIndex = index.length - 1
  let interpolateIndex = 0
  for (let i = 0; i < len; i++) {
    const q = queryIndex[i]!
    if (q <= index[0]!) {
      out[i] = values[0]!
      continue
    }
    if (q >= index[lastValueIndex]!) {
      out[i] = values[lastValueIndex]!
      continue
    }
    for (; interpolateIndex < lastValueIndex; interpolateIndex++) {
      const next = index[interpolateIndex + 1]!
      if (q < next) {
        const prev = index[interpolateIndex]!
        const ratio = (q - prev) / (next - prev)
        const v0 = values[interpolateIndex]!
        out[i] = v0 + (values[interpolateIndex + 1]! - v0) * ratio
        break
      }
    }
  }
  return out
}
