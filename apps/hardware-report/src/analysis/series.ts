/**
 * Time series extracted from the log for plotting. The UI turns these into Plotly traces.
 */
import { timeUsToSeconds, type DataflashLog, type NumericColumn } from '@apwt/dataflash'

/** A named y-against-time series. */
export interface Series {
  /** Legend name. */
  readonly name: string
  /** Seconds since boot. */
  readonly time: Float64Array
  /** Values (units per series). */
  readonly values: Float64Array
}

/** Copy a column into a Float64Array, multiplying by `scale`. */
export function toFloat64(col: ArrayLike<number>, scale = 1): Float64Array {
  const out = new Float64Array(col.length)
  for (let i = 0; i < col.length; i++) out[i] = (col[i] as number) * scale
  return out
}

/** `TimeUS` of a message (or instance) in seconds, or `undefined`. */
export function timeSeconds(log: DataflashLog, message: string, instance?: number): Float64Array | undefined {
  const t = log.getNumbers(message, 'TimeUS', instance)
  return t === undefined ? undefined : timeUsToSeconds(t)
}

/** A series of one field against its message's time, or `undefined` when missing. */
export function fieldSeries(
  log: DataflashLog,
  name: string,
  message: string,
  field: string,
  instance?: number,
  scale = 1
): Series | undefined {
  const time = timeSeconds(log, message, instance)
  const values = log.getNumbers(message, field, instance)
  if (time === undefined || values === undefined) return undefined
  return { name, time, values: toFloat64(values, scale) }
}

/** Whether every value is NaN (upstream `array_all_NaN`; true for an empty column). */
export function allNaN(col: NumericColumn | Float64Array): boolean {
  for (let i = 0; i < col.length; i++) if (!Number.isNaN(col[i])) return false
  return true
}
