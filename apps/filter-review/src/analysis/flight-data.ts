import type { DataflashLog } from '@apwt/dataflash'
import { readSeries } from './tracking/read-series.js'
import type { LoggedSeries } from './tracking/target.js'

/** Context traces drawn above the spectra (s against value). */
export interface FlightData {
  readonly roll?: LoggedSeries
  readonly pitch?: LoggedSeries
  readonly throttle?: LoggedSeries
  readonly altitude?: LoggedSeries
}

/** Read roll, pitch (ATT), throttle (RATE.AOut) and altitude (POS.RelHomeAlt). */
export function readFlightData(log: DataflashLog): FlightData {
  const out: { -readonly [K in keyof FlightData]: FlightData[K] } = {}
  const roll = readSeries(log, 'ATT', 'Roll')
  const pitch = readSeries(log, 'ATT', 'Pitch')
  const throttle = readSeries(log, 'RATE', 'AOut')
  const altitude = readSeries(log, 'POS', 'RelHomeAlt')
  if (roll) out.roll = roll
  if (pitch) out.pitch = pitch
  if (throttle) out.throttle = throttle
  if (altitude) out.altitude = altitude
  return out
}

/**
 * Times of the first and last positive throttle. Upstream tests the found index for
 * truthiness, so a match at index 0 is ignored and a missing match yields `undefined`.
 */
export function throttleActiveRange(throttle: LoggedSeries | undefined): { first: number | undefined; last: number | undefined } {
  if (throttle === undefined) return { first: undefined, last: undefined }
  const values = throttle.value
  let firstIndex = -1
  let lastIndex = -1
  for (let i = 0; i < values.length; i++) {
    if (values[i]! > 0.0) {
      if (firstIndex === -1) firstIndex = i
      lastIndex = i
    }
  }
  return {
    first: firstIndex > 0 ? throttle.time[firstIndex] : undefined,
    last: lastIndex > 0 ? throttle.time[lastIndex] : undefined
  }
}

/** Data span and default analysis window, in seconds. */
export interface DefaultTimeRange {
  /** Floor of the gyro data start. */
  readonly dataStart: number
  /** Ceiling of the gyro data end. */
  readonly dataEnd: number
  /** Default analysis start: one second into the flown section when throttle is logged. */
  readonly start: number
  /** Default analysis end: one second before the throttle drops back to zero. */
  readonly end: number
}

/** Default analysis window from the gyro span and the throttle trace (upstream `load()`). */
export function defaultTimeRange(gyroStart: number, gyroEnd: number, throttle: LoggedSeries | undefined): DefaultTimeRange {
  const dataStart = Math.floor(gyroStart)
  const dataEnd = Math.ceil(gyroEnd)
  let start = dataStart
  let end = dataEnd
  const { first, last } = throttleActiveRange(throttle)
  if (first !== undefined && last !== undefined) {
    // Round throttle points to center and add 1 second. This tries to crop out the throttle
    // rising from 0 and dropping back to 0
    start = Math.max(start, Math.ceil(first) + 1.0)
    end = Math.min(end, Math.floor(last) - 1.0)
  }
  return { dataStart, dataEnd, start, end }
}
