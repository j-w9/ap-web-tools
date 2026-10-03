// Flight overview series (upstream "Flight Data" plot in MAGFit `load`).

import { timeUsToSeconds, type DataflashLog } from '@apwt/dataflash'

/** A time series in seconds. */
export interface TimeSeries {
  readonly time: Float64Array
  readonly values: Float64Array
}

/** Series shown to help choose the analysis window; absent when the log lacks them. */
export interface FlightData {
  /** ATT.Roll, degrees. */
  readonly roll?: TimeSeries
  /** ATT.Pitch, degrees. */
  readonly pitch?: TimeSeries
  /** RATE.AOut, throttle output. */
  readonly throttle?: TimeSeries
  /** POS.RelHomeAlt, metres. */
  readonly altitude?: TimeSeries
}

function series(log: DataflashLog, message: string, field: string): TimeSeries | undefined {
  const timeUs = log.getNumbers(message, 'TimeUS')
  const values = log.getNumbers(message, field)
  if (!timeUs || !values) return undefined
  const time = timeUsToSeconds(timeUs)
  return { time, values: Float64Array.from(values) }
}

/** Roll, pitch, throttle and altitude for the overview plot. */
export function loadFlightData(log: DataflashLog): FlightData {
  const out: { -readonly [K in keyof FlightData]: FlightData[K] } = {}
  const roll = series(log, 'ATT', 'Roll')
  const pitch = series(log, 'ATT', 'Pitch')
  const throttle = series(log, 'RATE', 'AOut')
  const altitude = series(log, 'POS', 'RelHomeAlt')
  if (roll) out.roll = roll
  if (pitch) out.pitch = pitch
  if (throttle) out.throttle = throttle
  if (altitude) out.altitude = altitude
  return out
}
