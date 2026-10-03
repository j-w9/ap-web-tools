import { timeUsToSeconds, type DataflashLog } from '@apwt/dataflash'
import type { LoggedSeries } from './target.js'

/** `TimeUS` of a message (or one instance) converted to seconds, as upstream `TimeUS_to_seconds`. */
export function readSeconds(log: DataflashLog, message: string, instance?: number): Float64Array | undefined {
  const timeUs = log.getNumbers(message, 'TimeUS', instance)
  return timeUs === undefined ? undefined : timeUsToSeconds(timeUs)
}

/** A numeric field copied to a Float64Array, or `undefined` if absent. */
export function readField(log: DataflashLog, message: string, field: string, instance?: number): Float64Array | undefined {
  const column = log.getNumbers(message, field, instance)
  return column === undefined ? undefined : Float64Array.from(column)
}

/** `field` of `message` against time in seconds, or `undefined` if either is missing. */
export function readSeries(log: DataflashLog, message: string, field: string, instance?: number): LoggedSeries | undefined {
  const time = readSeconds(log, message, instance)
  const value = readField(log, message, field, instance)
  if (time === undefined || value === undefined) return undefined
  return { time, value }
}

/** Whether `message` is logged with an instance field (upstream `"instances" in messageTypes[msg]`). */
export function isInstanced(log: DataflashLog, message: string): boolean {
  return log.messageType(message)?.instanceField !== undefined
}
