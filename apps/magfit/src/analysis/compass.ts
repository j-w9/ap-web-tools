// Per-compass data loading, ported from upstream MAGFit/magfit.js (MAG section of `load`).

import { compassParamNames, type CompassParamNames } from '@apwt/ardupilot'
import { timeUsToSeconds, type DataflashLog } from '@apwt/dataflash'
import { removeCalibration } from './calibration.js'
import { readCompassParams, type ExistingCompassParams } from './params.js'
import { vec3SeriesFrom, type Vec3Series } from './vector.js'

/** Maximum number of compasses MAGFit handles. */
export const MAX_COMPASSES = 3

/** One compass as loaded from the log. */
export interface CompassData {
  /** 0-based compass index (MAG instance). */
  readonly index: number
  readonly names: CompassParamNames
  /** Parameters in the log (last value of each). */
  readonly params: ExistingCompassParams
  /** Sample times, seconds. */
  readonly time: Float64Array
  readonly startTime: number
  readonly endTime: number
  /** Field as logged, with the existing calibration applied, mGauss. */
  readonly logged: Vec3Series
  /** Field with the existing calibration removed (sensor frame if {@link rotated}). */
  readonly raw: Vec3Series
  /** Whether the orientation was undone, enabling the orientation check (upstream `rotate`). */
  readonly rotated: boolean
  /** Every MAG record reported healthy. */
  readonly healthy: boolean
}

/** Load MAG instance `index`, or `undefined` if it is not in the log. */
export function loadCompass(log: DataflashLog, index: number): CompassData | undefined {
  if (!log.instances('MAG').includes(index)) return undefined
  const col = (field: string): ArrayLike<number> => {
    const c = log.getNumbers('MAG', field, index)
    if (c === undefined) throw new Error(`MAG instance ${index} has no ${field} field`)
    return c
  }

  const timeUs = col('TimeUS')
  const time = timeUsToSeconds(timeUs)

  const names = compassParamNames(index + 1)
  const params = readCompassParams(log.params(), names)
  const logged = vec3SeriesFrom(col('MagX'), col('MagY'), col('MagZ'))
  const { raw, rotated } = removeCalibration(
    logged,
    {
      offsets: vec3SeriesFrom(col('OfsX'), col('OfsY'), col('OfsZ')),
      motor: vec3SeriesFrom(col('MOX'), col('MOY'), col('MOZ'))
    },
    params
  )

  const health = log.getNumbers('MAG', 'Health', index)
  let healthy = true
  if (health !== undefined) for (let i = 0; i < health.length; i++) healthy &&= health[i] === 1

  return {
    index,
    names,
    params,
    time,
    startTime: time[0]!,
    endTime: time[time.length - 1]!,
    logged,
    raw,
    rotated,
    healthy
  }
}
