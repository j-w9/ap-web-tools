/**
 * Display formatting for the finder table (upstream LogFinder Tabulator formatters).
 */

const SIZE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const

/** File size with binary units and two decimals, e.g. `"1.50 MB"` (upstream `size_format`). */
export function formatSize(bytes: number): string {
  const index = bytes === 0 ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), SIZE_UNITS.length - 1)
  return `${(bytes / 1024 ** index).toFixed(2)} ${SIZE_UNITS[index] ?? 'B'}`
}

/** Distance in metres below 2 km, else kilometres (upstream `get_dist_string`). */
export function formatDistance(metres: number | undefined): string {
  if (metres === undefined) return '-'
  if (metres < 2000) return `${metres.toFixed(2)} m`
  return `${(metres / 1000).toFixed(2)} km`
}

/** Units luxon's `Duration.rescale()` shifts to, with their length in milliseconds (casual conversion). */
const DURATION_UNITS = [
  ['year', 365 * 24 * 3600e3],
  ['month', 30 * 24 * 3600e3],
  ['week', 7 * 24 * 3600e3],
  ['day', 24 * 3600e3],
  ['hour', 3600e3],
  ['minute', 60e3],
  ['second', 1e3],
  ['millisecond', 1]
] as const

/**
 * Flight time as a human readable duration, e.g. `"1 hr, 2 min, 5 sec"`. `"Unknown"` when not
 * logged and `"-"` for zero (upstream `flight_time_format`).
 *
 * Deviation: upstream uses luxon's `Duration.rescale().toHuman()`; this reproduces it with `Intl`
 * (largest units first, zero units dropped, short unit names, narrow list) without the dependency.
 */
export function formatFlightTime(seconds: number | undefined, locale?: string): string {
  if (seconds === undefined) return 'Unknown'
  if (seconds === 0) return '-'
  let remaining = Math.round(Math.abs(seconds) * 1000)
  const sign = seconds < 0 ? -1 : 1
  const parts: string[] = []
  for (const [unit, ms] of DURATION_UNITS) {
    const count = Math.floor(remaining / ms)
    remaining -= count * ms
    if (count === 0) continue
    parts.push(new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short' }).format(sign * count))
  }
  return new Intl.ListFormat(locale, { type: 'conjunction', style: 'narrow' }).format(parts)
}

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * Local date and time as `dd/MM/yyyy hh:mm:ss a`, or `"No GPS"` without a GPS time
 * (upstream Tabulator `datetime` formatter parameters).
 */
export function formatStartTime(time: Date | undefined): string {
  if (time === undefined) return 'No GPS'
  const hours = time.getHours()
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return (
    `${pad(time.getDate())}/${pad(time.getMonth() + 1)}/${time.getFullYear()} ` +
    `${pad(hour12)}:${pad(time.getMinutes())}:${pad(time.getSeconds())} ${hours < 12 ? 'AM' : 'PM'}`
  )
}
