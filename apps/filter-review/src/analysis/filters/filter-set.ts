import { complexDiv, type ComplexArray } from '@apwt/signal'
import type { FilterParams } from '../filter-params.js'
import type { FilterVersion } from '../filter-version.js'
import type { NotchTarget } from '../tracking/target.js'
import { HarmonicNotchFilter, type TrackingInterpolation } from './harmonic-notch.js'
import { LowPassFilter } from './low-pass.js'
import { copyAccumulator, unitAccumulator, type ZGrid } from './z-grid.js'

/** The gyro filter chain: one low-pass and the harmonic notches. */
export interface FilterSet {
  readonly lowPass: LowPassFilter
  readonly notches: readonly HarmonicNotchFilter[]
}

/** Build the filter chain from parameters (upstream `load_filters`). */
export function buildFilters(params: FilterParams, targets: readonly NotchTarget[], filterVersion: FilterVersion): FilterSet {
  return {
    lowPass: new LowPassFilter(params.gyroFilter),
    notches: params.notches.map((p) => new HarmonicNotchFilter(p, targets, filterVersion))
  }
}

/**
 * Filter transfer function H at every FFT window time (upstream `calculate_transfer_function`
 * inner `calc`). The low-pass and static notches are evaluated once; dynamic notches per window.
 *
 * @param numTimes Number of FFT windows.
 * @param tracking Tracking data interpolated onto those windows for this gyro instance.
 */
export function transferFunctions(
  filters: FilterSet,
  tracking: TrackingInterpolation,
  numTimes: number,
  sampleRate: number,
  grid: ZGrid
): ComplexArray[] {
  const staticH = unitAccumulator(grid.z1.re.length)

  // Low pass does not change frequency in flight
  filters.lowPass.transfer(staticH, sampleRate, grid)

  // Evaluate any static notch
  for (const notch of filters.notches) {
    if (notch.enabled && notch.isStatic) notch.transfer(staticH, tracking, 0, sampleRate, grid)
  }

  // Evaluate dynamic notches at each time step
  const out = new Array<ComplexArray>(numTimes)
  for (let j = 0; j < numTimes; j++) {
    const h = copyAccumulator(staticH)
    for (const notch of filters.notches) {
      if (notch.enabled && !notch.isStatic) notch.transfer(h, tracking, j, sampleRate, grid)
    }
    out[j] = complexDiv(h.num, h.den)
  }
  return out
}
