// Interference sources for compass motor compensation, ported from upstream MAGFit/magfit.js
// (battery current loading in `load`).

import { timeUsToSeconds, type DataflashLog } from '@apwt/dataflash'
import { arrayAllEqual, arrayAllNaN, linearInterp } from '@apwt/signal'
import type { MotorCompType } from './params.js'

/** A logged quantity that magnetic interference is assumed proportional to. */
export interface MotorSource {
  /** Display name, e.g. "Battery 1 current". */
  readonly name: string
  /** `COMPASS_MOTCT` value for fits using this source. */
  readonly type: MotorCompType
  /** Sample times, seconds. */
  readonly time: Float64Array
  readonly value: Float64Array
}

/** A motor source with its values resampled for the fits (see {@link motorSourceAt}). */
export interface FitMotorSource extends MotorSource {
  /** {@link value} interpolated at each compass's own sample times, by compass index (`undefined` where absent). */
  readonly atCompass: readonly (Float64Array | undefined)[]
}

/**
 * Battery current sources. Like upstream only the first battery (BAT instance 0) is used, and
 * it is skipped when its current is all NaN or all zero (no current sensor).
 */
export function loadMotorSources(log: DataflashLog): MotorSource[] {
  const out: MotorSource[] = []
  for (let i = 0; i < 1; i++) {
    if (!log.instances('BAT').includes(i)) continue
    const curr = log.getNumbers('BAT', 'Curr', i)
    const timeUs = log.getNumbers('BAT', 'TimeUS', i)
    // Upstream runs Array.from on the columns and crashes when one is missing.
    if (!curr || !timeUs) throw new Error('BAT is missing the Curr or TimeUS field')
    if (arrayAllNaN(curr) || arrayAllEqual(curr, 0)) continue
    const time = timeUsToSeconds(timeUs)
    out.push({ name: 'Battery ' + String(i + 1) + ' current', type: 2, time, value: Float64Array.from(curr) })
  }
  return out
}

/**
 * Resample a motor source onto one compass's sample times, so the fit reads one value per compass
 * sample. Proven upstream bug fixed (docs/bug-proofs/magfit.md, row 1): upstream interpolates onto
 * `MAG_Data[i].time` with `i` the battery index (always 0), i.e. compass 1's times for every
 * compass, and crashes when compass 1 is absent.
 */
export function motorSourceAt(source: MotorSource, compassTime: ArrayLike<number>): Float64Array {
  return linearInterp(source.value, source.time, compassTime)
}
