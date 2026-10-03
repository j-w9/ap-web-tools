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
  /** {@link value} interpolated at compass 1's sample times. */
  readonly atCompass0: Float64Array
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
 * Resample a motor source onto the compass time base upstream uses. Upstream interpolates onto
 * `MAG_Data[i].time` where `i` is the battery index (always 0), so every compass's fit uses the
 * current resampled at compass 1's sample times, indexed by its own sample number. Reproduced
 * (upstream bug, see docs/upstream-bugs.md): when compasses log at different times or rates the
 * current is misaligned, and samples past compass 1's length read as `undefined` (NaN).
 *
 * @param compass0Time Sample times of MAG instance 0. Upstream crashes when that compass is
 * absent and a battery current source exists; this throws instead.
 */
export function motorSourceAt(source: MotorSource, compass0Time: ArrayLike<number> | undefined): Float64Array {
  if (compass0Time === undefined) {
    throw new Error(source.name + ' cannot be used for motor compensation without compass 1 (MAG instance 0) in the log')
  }
  return linearInterp(source.value, source.time, compass0Time)
}
