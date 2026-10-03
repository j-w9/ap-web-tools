/**
 * Grouping, filtering, sorting and per-row parameter diffs for the finder tables (upstream
 * LogFinder `setup_table`, `update_param_diff` and the Tabulator column calculations).
 */
import type { VehicleType } from '@apwt/dataflash'
import { paramDiff, type ParamDiff, type ParamIgnoreKey } from './param-diff.js'
import { logWarnings, type LogSummary } from './summary.js'

/** A file that was scanned and summarised. `F` is the caller's file handle type. */
export interface ScannedLog<F> {
  /** Path from the chosen folder, used as the row identity (upstream `rel_path`). */
  readonly relativePath: string
  /** File name without directories. */
  readonly name: string
  readonly file: F
  readonly summary: LogSummary
}

/** Group heading used for logs whose boot messages do not name the board. */
export const UNKNOWN_BOARD = 'Unknown'

/** Logs from one flight controller (upstream: one `<details>` table per board). */
export interface BoardGroup<F> {
  /** Board line from the boot messages, or {@link UNKNOWN_BOARD}. */
  readonly board: string
  /** Longest common prefix of the group's paths (the whole path for a single log). */
  readonly commonPath: string
  readonly logs: readonly ScannedLog<F>[]
}

/** Character-wise longest common prefix of the paths (upstream `get_common_path`). */
export function commonPath(paths: readonly string[]): string {
  const first = paths[0]
  if (first === undefined) return ''
  for (let i = 0; i <= first.length; i++) {
    for (let j = 1; j < paths.length; j++) {
      if (first[i] !== paths[j]![i]) return first.slice(0, i)
    }
  }
  return first
}

/** Split logs by flight controller, groups in order of first appearance. */
export function groupByBoard<F>(logs: readonly ScannedLog<F>[]): BoardGroup<F>[] {
  const groups = new Map<string, ScannedLog<F>[]>()
  for (const log of logs) {
    const key = log.summary.version.flightController ?? UNKNOWN_BOARD
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [log])
    else list.push(log)
  }
  return [...groups].map(([board, list]) => ({ board, commonPath: commonPath(list.map((l) => l.relativePath)), logs: list }))
}

// ----------------------------------------------------------------- sorting

/** Sortable columns. Parameter changes and actions are not sortable, as upstream. */
export type SortKey = 'date' | 'name' | 'size' | 'vehicle' | 'firmware' | 'flightTime' | 'distance'
export type SortDirection = 'asc' | 'desc'
export interface SortState {
  readonly key: SortKey
  readonly direction: SortDirection
}

/** Upstream's initial sort: oldest first. */
export const DEFAULT_SORT: SortState = { key: 'date', direction: 'asc' }

type SortValue = number | string | undefined

const SORT_VALUES: Readonly<Record<SortKey, (s: ScannedLog<unknown>) => SortValue>> = {
  date: (l) => l.summary.startTime?.getTime(),
  name: (l) => l.name,
  size: (l) => l.summary.sizeBytes,
  vehicle: (l) => l.summary.vehicle,
  firmware: (l) => l.summary.version.fwString,
  flightTime: (l) => l.summary.flightTimeS,
  distance: (l) => l.summary.distanceM
}

function compareValues(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

/**
 * Sort logs by a column. Missing values (no GPS time, no flight time, ...) go last in either
 * direction; ties keep path order so the result is stable.
 */
export function sortLogs<F>(logs: readonly ScannedLog<F>[], sort: SortState): ScannedLog<F>[] {
  const value = SORT_VALUES[sort.key]
  const sign = sort.direction === 'asc' ? 1 : -1
  return [...logs].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    if (va === undefined || vb === undefined) {
      if (va !== vb) return va === undefined ? 1 : -1
    } else {
      const c = compareValues(va, vb)
      if (c !== 0) return sign * c
    }
    return a.relativePath.localeCompare(b.relativePath)
  })
}

/** Next sort after clicking a column header: toggle direction on the same column, else ascending. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key !== key) return { key, direction: 'asc' }
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
}

// ----------------------------------------------------------------- filtering

/** Vehicle filter value: a vehicle family, or logs that do not identify one. */
export type VehicleFilterKey = VehicleType | 'unknown'

/** Filters applied to the scanned logs. Not in upstream, which only lists logs. */
export interface LogFilter {
  /** Case-insensitive text matched against path, firmware, board and OS strings. */
  readonly text: string
  /** Vehicles to hide; empty shows every vehicle. */
  readonly hiddenVehicles: ReadonlySet<VehicleFilterKey>
  /** Only logs with a crash dump, watchdog or disabled arming checks. */
  readonly warningsOnly: boolean
  /** Only logs whose flight time is known and above zero. */
  readonly flownOnly: boolean
  /** Earliest start time (inclusive); logs without GPS time are hidden when set. */
  readonly from: Date | undefined
  /** Latest start time (inclusive). */
  readonly to: Date | undefined
}

export const NO_FILTER: LogFilter = {
  text: '',
  hiddenVehicles: new Set(),
  warningsOnly: false,
  flownOnly: false,
  from: undefined,
  to: undefined
}

/** Vehicle filter key of a log. */
export function vehicleKey(summary: LogSummary): VehicleFilterKey {
  return summary.vehicle ?? 'unknown'
}

/** Whether a log passes the filter. */
export function matchesFilter(log: ScannedLog<unknown>, filter: LogFilter): boolean {
  const s = log.summary
  if (filter.hiddenVehicles.has(vehicleKey(s))) return false
  if (filter.warningsOnly && logWarnings(s).length === 0) return false
  if (filter.flownOnly && !(s.flightTimeS !== undefined && s.flightTimeS > 0)) return false
  if (filter.from !== undefined || filter.to !== undefined) {
    const t = s.startTime?.getTime()
    if (t === undefined) return false
    if (filter.from !== undefined && t < filter.from.getTime()) return false
    if (filter.to !== undefined && t > filter.to.getTime()) return false
  }
  const text = filter.text.trim().toLowerCase()
  if (text !== '') {
    const fields = [log.relativePath, s.version.fwString, s.version.flightController, s.version.osString, s.boardName]
    if (!fields.some((f) => f?.toLowerCase().includes(text))) return false
  }
  return true
}

/**
 * Parse a `<input type="date">` value (`YYYY-MM-DD`) as local time: the start of the day, or with
 * `endOfDay` the last millisecond of it. `undefined` for an empty or malformed value.
 */
export function parseDateInput(value: string, endOfDay = false): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (m?.[1] === undefined || m[2] === undefined || m[3] === undefined) return undefined
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (endOfDay) date.setHours(23, 59, 59, 999)
  return date
}

// ----------------------------------------------------------------- table rows

/** One table row: a log and its parameter changes since the row above. */
export interface TableRow<F> {
  readonly log: ScannedLog<F>
  /** `null` for the first row, which has nothing to compare with. */
  readonly paramDiff: ParamDiff | null
}

/** Column totals shown below a table with more than one row. */
export interface TableTotals {
  readonly sizeBytes: number
  /** Sum of known flight times; unknown values count as zero, as Tabulator's `sum`. */
  readonly flightTimeS: number
  readonly distanceM: number
  /** Parameter changes from the first row to the last. */
  readonly paramDiff: ParamDiff
}

/** A board's table after filtering and sorting. */
export interface BoardTable<F> {
  readonly board: string
  readonly commonPath: string
  readonly rows: readonly TableRow<F>[]
  /** `null` with fewer than two rows (upstream hides the calculation row then). */
  readonly totals: TableTotals | null
}

/**
 * Diff each row's parameters against the row above, in display order (upstream
 * `update_param_diff`, run after every sort).
 */
export function withParamDiffs<F>(logs: readonly ScannedLog<F>[], ignored: ReadonlySet<ParamIgnoreKey>): TableRow<F>[] {
  return logs.map((log, i) => {
    const previous = i > 0 ? logs[i - 1] : undefined
    return { log, paramDiff: previous === undefined ? null : paramDiff(log.summary.params, previous.summary.params, ignored) }
  })
}

/** Totals for a table (upstream `bottomCalc` sums and `total_param_diff_calc`). */
export function tableTotals(logs: readonly ScannedLog<unknown>[], ignored: ReadonlySet<ParamIgnoreKey>): TableTotals | null {
  const first = logs[0]
  const last = logs[logs.length - 1]
  if (logs.length <= 1 || first === undefined || last === undefined) return null
  let sizeBytes = 0
  let flightTimeS = 0
  let distanceM = 0
  for (const { summary } of logs) {
    sizeBytes += summary.sizeBytes
    flightTimeS += summary.flightTimeS ?? 0
    distanceM += summary.distanceM ?? 0
  }
  return { sizeBytes, flightTimeS, distanceM, paramDiff: paramDiff(last.summary.params, first.summary.params, ignored) }
}

/**
 * Build the tables to show: logs grouped by board, then filtered, sorted and diffed. Parameter
 * diffs compare neighbouring visible rows, so a filter changes what each row is compared with.
 * Boards with no visible logs are dropped.
 */
export function buildTables<F>(
  logs: readonly ScannedLog<F>[],
  options: { readonly filter: LogFilter; readonly sort: SortState; readonly ignored: ReadonlySet<ParamIgnoreKey> }
): BoardTable<F>[] {
  const out: BoardTable<F>[] = []
  for (const group of groupByBoard(logs)) {
    const visible = sortLogs(
      group.logs.filter((l) => matchesFilter(l, options.filter)),
      options.sort
    )
    if (visible.length === 0) continue
    out.push({
      board: group.board,
      commonPath: group.commonPath,
      rows: withParamDiffs(visible, options.ignored),
      totals: tableTotals(visible, options.ignored)
    })
  }
  return out
}
