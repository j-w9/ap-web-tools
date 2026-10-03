import { arrayAdd, arrayMax, arrayMin, arrayScale, complexAbs, complexPhase, type ComplexArray } from '@apwt/signal'
import type { TimeRange } from '../time-index.js'
import { windowRange } from './spectrum.js'

/**
 * Phase in degrees, unwrapped (upstream `get_phase`). Notches cause large positive phase
 * steps, so the unwrap is biased: only drops of more than 45 deg are treated as wraps.
 */
export function unwrapPhase(h: ComplexArray): Float64Array {
  const phase = arrayScale(complexPhase(h), 180 / Math.PI)
  const len = phase.length
  const negThreshold = 45
  const posThreshold = 360 - negThreshold
  const unwrapped = new Float64Array(len)
  unwrapped[0] = phase[0]!
  for (let i = 1; i < len; i++) {
    let phaseDiff = phase[i]! - phase[i - 1]!
    if (phaseDiff >= posThreshold) {
      phaseDiff -= 360
    } else if (phaseDiff <= -negThreshold) {
      phaseDiff += 360
    }
    unwrapped[i] = unwrapped[i - 1]! + phaseDiff
  }
  return unwrapped
}

/**
 * Wrap several phase arrays into +-180 deg, all shifted by the amount that wraps the first
 * (upstream `phase_scale` with "wrap" selected). Returns new arrays; the inputs are untouched.
 */
export function wrapPhase(phase: readonly ArrayLike<number>[]): Float64Array[] {
  const out = phase.map((p) => Float64Array.from(p))
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

/** Mean and envelope of the filter response over a time range. */
export interface BodeResponse {
  /** Frequency grid (Hz). */
  readonly freq: Float64Array
  /** Linear amplitude; apply `AmplitudeScale.scale` to plot. */
  readonly ampMean: Float64Array
  readonly ampMax: Float64Array
  readonly ampMin: Float64Array
  /** Unwrapped phase (deg); see {@link wrapPhase}. */
  readonly phaseMean: Float64Array
  readonly phaseMax: Float64Array
  readonly phaseMin: Float64Array
}

/**
 * Average the per-window filter response over `range` (upstream `redraw_post_estimate_and_bode`).
 *
 * @param transfer Response on the Bode grid at each window (`InstanceTransfer.bode`).
 * @param time FFT window centre times (s).
 */
export function bodeResponse(
  freq: Float64Array,
  transfer: readonly ComplexArray[],
  time: ArrayLike<number>,
  range: TimeRange
): BodeResponse {
  const { start, end } = windowRange(time, range)
  // Scale factor to get mean from accumulated samples
  const meanScale = 1 / (end - start)
  const len = transfer[0]?.re.length ?? 0
  let ampMean: Float64Array = new Float64Array(len)
  let phaseMean: Float64Array = new Float64Array(len)
  let ampMax: Float64Array = ampMean
  let ampMin: Float64Array = ampMean
  let phaseMax: Float64Array = phaseMean
  let phaseMin: Float64Array = phaseMean
  for (let j = start; j < end; j++) {
    const h = transfer[j]!
    const att = complexAbs(h)
    const phase = unwrapPhase(h)
    ampMean = arrayAdd(ampMean, att)
    phaseMean = arrayAdd(phaseMean, phase)
    if (j > start) {
      ampMax = arrayMax(ampMax, att)
      ampMin = arrayMin(ampMin, att)
      phaseMax = arrayMax(phaseMax, phase)
      phaseMin = arrayMin(phaseMin, phase)
    } else {
      ampMax = att
      ampMin = att
      phaseMax = phase
      phaseMin = phase
    }
  }
  return {
    freq,
    ampMean: arrayScale(ampMean, meanScale),
    ampMax,
    ampMin,
    phaseMean: arrayScale(phaseMean, meanScale),
    phaseMax,
    phaseMin
  }
}
