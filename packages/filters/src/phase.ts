/**
 * Phase in degrees, unwrapped or wrapped. Notches produce large positive phase steps, so the
 * upstream unwraps are biased: a rise is only a wrap above 315 deg, a drop already above 45 deg.
 * FilterTool / AnalyticTune (`unwrap`) and FilterReview (`get_phase`) differ at the thresholds
 * themselves, so both are kept.
 */
import { arrayScale, complexPhase, type ComplexArrayLike } from '@apwt/signal'

const NEG_THRESHOLD = 45
const POS_THRESHOLD = 360 - NEG_THRESHOLD

/** Phase of `h` in degrees, in (-180, 180]. */
export function phaseDegrees(h: ComplexArrayLike): Float64Array {
  return arrayScale(complexPhase(h), 180 / Math.PI)
}

/** Upstream FilterTool / AnalyticTune `unwrap`: jumps strictly beyond the thresholds are wraps. */
export function unwrapPhase(phase: ArrayLike<number>): Float64Array {
  return unwrap(
    phase,
    (diff) => diff > POS_THRESHOLD,
    (diff) => diff < -NEG_THRESHOLD
  )
}

/** Upstream FilterReview `get_phase` unwrap: jumps at or beyond the thresholds are wraps. */
export function unwrapPhaseInclusive(phase: ArrayLike<number>): Float64Array {
  return unwrap(
    phase,
    (diff) => diff >= POS_THRESHOLD,
    (diff) => diff <= -NEG_THRESHOLD
  )
}

function unwrap(
  phase: ArrayLike<number>,
  wrapsDown: (diff: number) => boolean,
  wrapsUp: (diff: number) => boolean
): Float64Array {
  const len = phase.length
  const unwrapped = new Float64Array(len)
  if (len === 0) return unwrapped
  unwrapped[0] = phase[0]!
  for (let i = 1; i < len; i++) {
    let diff = phase[i]! - phase[i - 1]!
    if (wrapsDown(diff)) {
      diff -= 360.0
    } else if (wrapsUp(diff)) {
      diff += 360.0
    }
    unwrapped[i] = unwrapped[i - 1]! + diff
  }
  return unwrapped
}

/**
 * Wrap several phase arrays into +-180 deg, all shifted by the amount that wraps the first
 * (upstream FilterReview `phase_scale` with "wrap" selected). Returns new arrays.
 *
 * Upstream shifts the arrays in place, so an array passed twice is shifted twice. That happens:
 * when the time range holds a single FFT window, upstream's phase max and min are the same array
 * and come out shifted by 720 deg where the mean is shifted by 360. To reproduce it without
 * mutating the inputs, an input that appears more than once maps to one shared output copy.
 */
export function wrapPhase(phase: readonly ArrayLike<number>[]): Float64Array[] {
  const copies = new Map<ArrayLike<number>, Float64Array>()
  const out = phase.map((p) => {
    let copy = copies.get(p)
    if (copy === undefined) {
      copy = Float64Array.from(p)
      copies.set(p, copy)
    }
    return copy
  })
  const first = out[0]
  if (first === undefined) return out
  const len = first.length
  for (let i = 1; i < len; i++) {
    if (first[i]! > 180) {
      for (const p of out) p[i] = p[i]! - 360
    } else if (first[i]! < -180) {
      for (const p of out) p[i] = p[i]! + 360
    }
    // Repeat this element until it is in range
    if (Math.abs(first[i]!) > 180) i--
  }
  return out
}
