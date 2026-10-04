/**
 * Display formatting for the finder table (upstream LogFinder Tabulator formatters). Dates and
 * durations go through luxon, as upstream's do.
 */
import { DateTime, Duration } from 'luxon'

const SIZE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const

/**
 * File size with binary units and two decimals, e.g. `"1.50 MB"` (upstream `size_format`). The unit
 * index is clamped to TB: upstream prints the unit as `undefined` from about 1024 TB (proven upstream
 * bug, see docs/bug-proofs/log-finder.md).
 */
export function formatSize(bytes: number): string {
  const index = bytes === 0 ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), SIZE_UNITS.length - 1)
  return `${(bytes / Math.pow(1024, index)).toFixed(2)} ${String(SIZE_UNITS[index])}`
}

/** Distance in metres below 2 km, else kilometres (upstream `get_dist_string`). */
export function formatDistance(metres: number | undefined): string {
  if (metres === undefined) return '-'
  if (metres < 2000) return metres.toFixed(2) + ' m'
  const km = metres / 1000.0
  return km.toFixed(2) + ' km'
}

/**
 * Flight time as a human readable duration, e.g. `"1 hr, 2 min, 5 sec"`: `"Unknown"` when not
 * logged, `"-"` for zero, else luxon `Duration.fromMillis(s * 1000).rescale().toHuman(...)`
 * (upstream `flight_time_format`).
 */
export function formatFlightTime(seconds: number | undefined): string {
  if (seconds === undefined) return 'Unknown'
  if (seconds === 0) return '-'
  return Duration.fromMillis(seconds * 1000)
    .rescale()
    .toHuman({ listStyle: 'narrow', unitDisplay: 'short' })
}

/**
 * Start time as Tabulator's `datetime` formatter shows it with upstream's parameters: luxon
 * `dd/MM/yyyy hh:mm:ss a` in local time, or `"No GPS"` for an invalid (missing) time.
 */
export function formatStartTime(time: Date | undefined): string {
  const dt = time === undefined ? DateTime.invalid('No GPS time') : DateTime.fromJSDate(time)
  return dt.isValid ? dt.toFormat('dd/MM/yyyy hh:mm:ss a') : 'No GPS'
}
