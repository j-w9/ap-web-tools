/** Loading a log for SysID: the message lists the signal pickers offer and the flight data plot. */
import { DataflashLog, US_TO_S } from '@apwt/dataflash'

/** One entry of the message pickers and the fields it offers. */
export interface LogMessage {
  /** `ATT`, or `IMU[0]` for one instance of an instanced message. */
  readonly name: string
  readonly fields: readonly string[]
}

export interface TimeSeries {
  readonly time: Float64Array
  readonly values: Float64Array
}

/** Series of the flight data plot: ATT.Roll, ATT.Pitch, RATE.AOut and POS.RelHomeAlt. */
export interface FlightData {
  readonly roll?: TimeSeries
  readonly pitch?: TimeSeries
  readonly throttle?: TimeSeries
  readonly altitude?: TimeSeries
}

export interface SysIdLog {
  readonly log: DataflashLog
  /** Picker entries, sorted by name. */
  readonly messages: readonly LogMessage[]
  readonly flight: FlightData
  /** First and last flight data time in seconds; `null` when the log has none of those messages. */
  readonly timeRange: readonly [number, number] | null
  /** Message types with records, for the "Open in" button. */
  readonly messageTypes: readonly string[]
}

/**
 * Upstream `populate_log_message_select`: every message type in the log, except instanced base
 * types, which are listed once per instance as `NAME[i]`; sorted with `localeCompare`.
 */
export function listMessages(log: DataflashLog): LogMessage[] {
  const out: LogMessage[] = []
  for (const info of log.messageTypes().values()) {
    const fields = info.fieldNames
    if (info.instances === undefined) out.push({ name: info.name, fields })
    else for (const instance of info.instances.keys()) out.push({ name: `${info.name}[${instance}]`, fields })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function series(log: DataflashLog, message: string, field: string): TimeSeries | undefined {
  const timeUs = log.getNumbers(message, 'TimeUS')
  const values = log.getNumbers(message, field)
  if (!timeUs || !values) return undefined
  return { time: Float64Array.from(timeUs, (t) => t * US_TO_S), values: Float64Array.from(values) }
}

/** Parse a log; throws if it is not a DataFlash log. */
export function loadLog(buffer: ArrayBuffer): SysIdLog {
  const log = DataflashLog.parse(buffer)

  const flight: { -readonly [K in keyof FlightData]: FlightData[K] } = {}
  const roll = series(log, 'ATT', 'Roll')
  const pitch = series(log, 'ATT', 'Pitch')
  const throttle = series(log, 'RATE', 'AOut')
  const altitude = series(log, 'POS', 'RelHomeAlt')
  if (roll) flight.roll = roll
  if (pitch) flight.pitch = pitch
  if (throttle) flight.throttle = throttle
  if (altitude) flight.altitude = altitude

  // Upstream `update_time`: the earliest first and latest last sample of the plotted messages.
  let start: number | undefined
  let end: number | undefined
  for (const s of [roll, throttle, altitude]) {
    if (!s || s.time.length === 0) continue
    const first = s.time[0]!
    const last = s.time[s.time.length - 1]!
    if (start === undefined || first < start) start = first
    if (end === undefined || last > end) end = last
  }

  return {
    log,
    messages: listMessages(log),
    flight,
    timeRange: start !== undefined && end !== undefined ? [start, end] : null,
    messageTypes: [...log.messageTypes().keys()]
  }
}
