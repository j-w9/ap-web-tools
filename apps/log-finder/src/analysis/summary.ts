/**
 * Per-log summary extraction (upstream LogFinder `load_log`).
 */
import { DataflashLog, type VehicleType } from '@apwt/dataflash'
import { boardName, getVersionAndBoard, type VersionAndBoard } from '@apwt/ardupilot'

/** Everything the finder shows about one log. */
export interface LogSummary {
  /** File size (upstream `size`). */
  readonly sizeBytes: number
  /** Vehicle family, when the log identifies it. Not shown upstream; used for filtering. */
  readonly vehicle: VehicleType | undefined
  /** Firmware and board identification (upstream `fw_string`, `git_hash`, `board_id`, `fc_string`, ...). */
  readonly version: VersionAndBoard
  /** Short APJ board name (upstream `board_name`). */
  readonly boardName: string | undefined
  /** Last value of every parameter. */
  readonly params: ReadonlyMap<string, number>
  /** Wall-clock start from GPS, `undefined` without a 3D fix (upstream `time_stamp`). */
  readonly startTime: Date | undefined
  /**
   * Flight time during this log in seconds: last minus first logged `STAT_FLTTIME`;
   * `undefined` when that parameter is never logged.
   */
  readonly flightTimeS: number | undefined
  /** A WDOG message is present: the board rebooted from a watchdog. */
  readonly watchdog: boolean
  /** The log contains an embedded `crash_dump.bin` file. */
  readonly crashDump: boolean
  /** 3D distance along the POS track; `undefined` without POS messages (upstream `distance_traveled`). */
  readonly distanceM: number | undefined
  /** Base message types present, for deciding which tools can open the log. */
  readonly messageTypes: readonly string[]
}

/** Why a file could not be summarised. */
export type SummaryFailure = 'parse-error' | 'not-a-log'

/** Outcome of {@link readLogSummary}. */
export type SummaryResult =
  { readonly ok: true; readonly summary: LogSummary } | { readonly ok: false; readonly reason: SummaryFailure }

/** Centi-degrees-e7 (lat/lng integer units) to metres, as AP_Common `LATLON_TO_M`. */
const LATLON_TO_M = 0.011131884502145034

/** Longitude difference in 1e-7 degrees, wrapped to ±180°. */
function diffLongitude(lon1: number, lon2: number): number {
  let dlon = lon1 - lon2
  if (dlon > 1800000000) dlon -= 3600000000
  else if (dlon < -1800000000) dlon += 3600000000
  return dlon
}

/** Scale applied to longitude differences at a latitude in 1e-7 degrees. */
function longitudeScale(lat: number): number {
  return Math.max(Math.cos(lat * (1.0e-7 * (Math.PI / 180.0))), 0.01)
}

/**
 * Sum of straight-line 3D distances between consecutive positions. Latitude and longitude in
 * 1e-7 degrees, altitude in metres.
 */
export function distanceTravelled(lat: ArrayLike<number>, lng: ArrayLike<number>, alt: ArrayLike<number>): number {
  let distance = 0
  for (let i = 1; i < lat.length; i++) {
    const x = (lat[i - 1]! - lat[i]!) * LATLON_TO_M
    const y = diffLongitude(lng[i - 1]!, lng[i]!) * LATLON_TO_M * longitudeScale((lat[i - 1]! + lat[i]!) / 2)
    const z = alt[i - 1]! - alt[i]!
    distance += Math.sqrt(x ** 2 + y ** 2 + z ** 2)
  }
  return distance
}

/** First and last logged values of `STAT_FLTTIME`, as upstream scans PARM records. */
function flightTime(log: DataflashLog): number | undefined {
  const names = log.getStrings('PARM', 'Name')
  const values = log.getNumbers('PARM', 'Value')
  if (names === undefined || values === undefined) return undefined
  let start: number | undefined
  let end: number | undefined
  for (let i = 0; i < names.length; i++) {
    if (names[i] !== 'STAT_FLTTIME') continue
    start ??= values[i]
    end = values[i]
  }
  return start === undefined || end === undefined ? undefined : end - start
}

function hasCrashDump(log: DataflashLog): boolean {
  return (log.getStrings('FILE', 'FileName') ?? []).some((name) => name.endsWith('crash_dump.bin'))
}

function distance(log: DataflashLog): number | undefined {
  if (!log.has('POS')) return undefined
  const lat = log.getNumbers('POS', 'Lat')
  const lng = log.getNumbers('POS', 'Lng')
  const alt = log.getNumbers('POS', 'Alt')
  if (lat === undefined || lng === undefined || alt === undefined) return 0
  return distanceTravelled(lat, lng, alt)
}

/** Summarise an already parsed log of `sizeBytes` bytes. */
export function summarizeLog(log: DataflashLog, sizeBytes: number): LogSummary {
  const version = getVersionAndBoard(log)
  return {
    sizeBytes,
    vehicle: log.vehicleType(),
    version,
    boardName: version.boardId === undefined ? undefined : boardName(version.boardId),
    params: log.params(),
    startTime: log.startTime(),
    flightTimeS: flightTime(log),
    watchdog: log.has('WDOG'),
    crashDump: hasCrashDump(log),
    distanceM: distance(log),
    messageTypes: [...log.messageTypes().keys()]
  }
}

/**
 * Parse and summarise a log file. Files that fail to parse or contain no message types (probably
 * not an ArduPilot log) are reported rather than thrown, as upstream skips them.
 */
export function readLogSummary(buffer: ArrayBuffer): SummaryResult {
  let log: DataflashLog
  try {
    log = DataflashLog.parse(buffer)
  } catch {
    return { ok: false, reason: 'parse-error' }
  }
  if (log.messageTypes().size === 0) return { ok: false, reason: 'not-a-log' }
  try {
    return { ok: true, summary: summarizeLog(log, buffer.byteLength) }
  } catch {
    return { ok: false, reason: 'parse-error' }
  }
}

/** A flight path in metres from the first position, for the path plot. */
export interface FlightPath {
  readonly northM: Float64Array
  readonly eastM: Float64Array
}

/**
 * POS track as north/east metres from the first point, using the same flat-earth scaling as
 * {@link distanceTravelled}. `undefined` without POS. Upstream draws this track on a Leaflet map.
 */
export function flightPath(log: DataflashLog): FlightPath | undefined {
  const lat = log.getNumbers('POS', 'Lat')
  const lng = log.getNumbers('POS', 'Lng')
  if (lat === undefined || lng === undefined || lat.length === 0) return undefined
  const lat0 = lat[0]!
  const lng0 = lng[0]!
  const northM = new Float64Array(lat.length)
  const eastM = new Float64Array(lat.length)
  for (let i = 0; i < lat.length; i++) {
    northM[i] = (lat[i]! - lat0) * LATLON_TO_M
    eastM[i] = diffLongitude(lng[i]!, lng0) * LATLON_TO_M * longitudeScale((lat[i]! + lat0) / 2)
  }
  return { northM, eastM }
}

/** Something about a log worth flagging (upstream `check_warnings`). */
export type LogWarning =
  | { readonly kind: 'crash-dump'; readonly docsUrl: string }
  | { readonly kind: 'watchdog'; readonly docsUrl: string }
  | { readonly kind: 'arming-checks-disabled' }

/** How serious the worst warning is: crash dumps and watchdogs are errors. */
export type WarningLevel = 'none' | 'caution' | 'error'

/** Warnings for a log, in upstream display order. */
export function logWarnings(summary: LogSummary): readonly LogWarning[] {
  const skip = summary.params.get('ARMING_SKIPCHK')
  const armingChecksDisabled = (skip !== undefined && skip > 0) || summary.params.get('ARMING_CHECK') === 0
  const out: LogWarning[] = []
  if (summary.crashDump) {
    out.push({ kind: 'crash-dump', docsUrl: 'https://ardupilot.org/copter/docs/common-watchdog.html#crash-dump' })
  }
  if (summary.watchdog) {
    out.push({
      kind: 'watchdog',
      docsUrl: 'https://ardupilot.org/copter/docs/common-watchdog.html#independent-watchdog-and-crash-dump'
    })
  }
  if (armingChecksDisabled) out.push({ kind: 'arming-checks-disabled' })
  return out
}

/** Worst level among `warnings`. */
export function warningLevel(warnings: readonly LogWarning[]): WarningLevel {
  if (warnings.some((w) => w.kind !== 'arming-checks-disabled')) return 'error'
  return warnings.length > 0 ? 'caution' : 'none'
}
