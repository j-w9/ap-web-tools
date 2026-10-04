import { phaseDegrees, unwrapPhaseInclusive } from '@apwt/filters'
import { arrayAdd, arrayMax, arrayMin, arrayScale, complexAbs, type ComplexArray } from '@apwt/signal'
import type { TimeRange } from '../time-index.js'
import { windowRange } from './spectrum.js'

/** Mean and envelope of the filter response over a time range. */
export interface BodeResponse {
  /** Frequency grid (Hz). */
  readonly freq: Float64Array
  /** Linear amplitude; apply `AmplitudeScale.scale` to plot. */
  readonly ampMean: Float64Array
  readonly ampMax: Float64Array
  readonly ampMin: Float64Array
  /** Unwrapped phase (deg); see `wrapPhase` in `@apwt/filters`. */
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
    // Upstream `get_phase`: FilterReview's unwrap treats jumps at the thresholds as wraps
    const phase = unwrapPhaseInclusive(phaseDegrees(h))
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
      // Proven upstream bug fixed (docs/bug-proofs/filter-review.md, row 12): upstream's max and
      // min were one array here, so with a single window "wrap" shifted it twice in place. A copy
      // keeps them distinct; their values are unchanged.
      phaseMin = Float64Array.from(phase)
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
