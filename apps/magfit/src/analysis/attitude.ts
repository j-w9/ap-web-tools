// Attitude sources for the expected body-frame field, ported from upstream MAGFit/magfit.js
// (attitude source loading in `load`).

import { timeUsToSeconds, type DataflashLog } from '@apwt/dataflash'
import type { QuatSeries } from './quaternion.js'

/** One attitude estimate available in the log. */
export interface AttitudeSource {
  /** Display name, e.g. "DCM", "EKF 2 IMU 1", "EKF 3 IMU 1". */
  readonly name: string
  /** `AHRS_EKF_TYPE` value this source corresponds to. */
  readonly ekfType: 0 | 2 | 3
  /** Sample times, seconds. */
  readonly time: Float64Array
  readonly attitude: QuatSeries
}

/** Attitude sources in the log and which one upstream selects by default. */
export interface AttitudeSources {
  readonly sources: readonly AttitudeSource[]
  /**
   * Index of the default source: the one matching `AHRS_EKF_TYPE` (the last match, as with
   * upstream's radio buttons), or the only source. `undefined` if the user must choose.
   */
  readonly defaultIndex: number | undefined
}

function load(
  log: DataflashLog,
  message: string,
  instance: number | undefined
): Omit<AttitudeSource, 'name' | 'ekfType'> | undefined {
  const timeUs = log.getNumbers(message, 'TimeUS', instance)
  const q1 = log.getNumbers(message, 'Q1', instance)
  const q2 = log.getNumbers(message, 'Q2', instance)
  const q3 = log.getNumbers(message, 'Q3', instance)
  const q4 = log.getNumbers(message, 'Q4', instance)
  if (!timeUs || !q1 || !q2 || !q3 || !q4) return undefined
  const time = timeUsToSeconds(timeUs)
  return {
    time,
    attitude: { q1: Float64Array.from(q1), q2: Float64Array.from(q2), q3: Float64Array.from(q3), q4: Float64Array.from(q4) }
  }
}

/**
 * Load DCM (AHR2), EKF2 (NKQ instance 0) and EKF3 (XKQ, `EK3_PRIMARY` instance) attitudes.
 * Like upstream this ignores primary lane changes during the flight.
 */
export function loadAttitudeSources(log: DataflashLog): AttitudeSources {
  const ekfType = log.param('AHRS_EKF_TYPE')
  const sources: AttitudeSource[] = []
  let defaultIndex: number | undefined

  const add = (name: string, type: 0 | 2 | 3, data: Omit<AttitudeSource, 'name' | 'ekfType'> | undefined): void => {
    if (data === undefined) return
    if (ekfType === type) defaultIndex = sources.length
    sources.push({ name, ekfType: type, ...data })
  }

  if (log.has('AHR2')) add('DCM', 0, load(log, 'AHR2', undefined))

  if (log.instances('NKQ').includes(0)) add('EKF 2 IMU 1', 2, load(log, 'NKQ', 0))

  const primary = log.param('EK3_PRIMARY') ?? 0
  if (log.instances('XKQ').includes(primary)) add('EKF 3 IMU ' + String(primary + 1), 3, load(log, 'XKQ', primary))

  if (sources.length === 1) defaultIndex = 0
  return { sources, defaultIndex }
}
