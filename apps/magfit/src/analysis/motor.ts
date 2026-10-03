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
    if (!curr || !timeUs) continue
    if (arrayAllNaN(curr) || arrayAllEqual(curr, 0)) continue
    const time = timeUsToSeconds(timeUs)
    out.push({ name: 'Battery ' + String(i + 1) + ' current', type: 2, time, value: Float64Array.from(curr) })
  }
  return out
}

/**
 * Resample a motor source onto a compass's sample times. Deliberate deviation: upstream
 * interpolates onto the time base of the compass with the battery's index (always MAG 0) for
 * every compass, which misaligns (or crashes) when compasses log at different times.
 */
export function motorSourceAt(source: MotorSource, time: ArrayLike<number>): Float64Array {
  return linearInterp(source.value, source.time, time)
}
