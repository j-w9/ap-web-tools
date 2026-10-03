/**
 * Facts VideoOverlay shows about a loaded log, and the default sync offset. Ported from upstream
 * `VideoOverlay.js` (`getFlightTime`, `getLogDurationUS`, `setDefaultOffset` and the log input
 * handler). Durations and dates are formatted with luxon, as upstream does.
 */
import { DateTime, Duration } from 'luxon'
import type { DataflashLog } from '@apwt/dataflash'
import { timestampBounds, type TimestampBounds } from './log-scan.js'

/** luxon's human duration in upstream's style, e.g. "1 hr, 2 min, 3 sec". */
function humanDuration(milliseconds: number): string {
  return Duration.fromMillis(milliseconds).rescale().toHuman({ listStyle: 'narrow', unitDisplay: 'short' })
}

/**
 * Flight time from the change in `STAT_FLTTIME` between its first and last logged value
 * (upstream `getFlightTime`): "Unknown" without PARM messages or the parameter, "-" when it did
 * not change, otherwise a human duration.
 */
export function flightTimeText(log: DataflashLog): string {
  if (!log.has('PARM')) return 'Unknown'
  const names = log.getStrings('PARM', 'Name') ?? []
  const values = log.getNumbers('PARM', 'Value')
  let startTime: number | undefined
  let endTime: number | undefined
  for (let i = 0; i < names.length; i++) {
    if (names[i] !== 'STAT_FLTTIME') continue
    const value = values?.[i]
    startTime ??= value
    endTime = value
  }
  if (startTime === undefined || endTime === undefined) return 'Unknown'
  const flightTime = endTime - startTime
  if (flightTime === 0) return '-'
  return humanDuration(flightTime * 1000)
}

/**
 * Log duration text (upstream log input handler): the span between the first and last timestamp,
 * rounded to whole seconds. `undefined` when the log has no timestamps; upstream then leaves the
 * previous text in place.
 */
export function logDurationText(bounds: TimestampBounds | undefined): string | undefined {
  if (bounds === undefined) return undefined
  const durationUs = bounds.lastTimeUs - bounds.firstTimeUs
  return humanDuration(Math.round(durationUs / 1000000) * 1000)
}

/**
 * Log start date in upstream's format, `dd/MM/yyyy hh:mm:ss a` in local time. Without a GPS start
 * time upstream passes `undefined` to luxon, which prints "Invalid DateTime"; so does this.
 */
export function logDateText(start: Date | undefined): string {
  return DateTime.fromJSDate(start ?? new Date(Number.NaN)).toFormat('dd/MM/yyyy hh:mm:ss a')
}

/**
 * Default log offset in seconds (upstream `setDefaultOffset`): shifts the log back so its first
 * timestamp lines up with the start of the video; 0 when the log has no timestamps.
 */
export function defaultOffsetS(bounds: TimestampBounds | undefined): number {
  if (bounds === undefined) return 0.0
  return -bounds.firstTimeUs / 1000000
}

/** Everything the log panel shows, computed once at load. */
export interface LogSummary {
  readonly date: string
  readonly flightTime: string
  /** `undefined`: keep showing the previous log's duration, as upstream does. */
  readonly duration: string | undefined
  readonly defaultOffsetS: number
}

/** Summarise a parsed log; `buffer` is the same bytes, scanned for timestamp positions. */
export function summariseLog(log: DataflashLog, buffer: ArrayBuffer): LogSummary {
  const bounds = timestampBounds(buffer)
  return {
    date: logDateText(log.startTime()),
    flightTime: flightTimeText(log),
    duration: logDurationText(bounds),
    defaultOffsetS: defaultOffsetS(bounds)
  }
}
