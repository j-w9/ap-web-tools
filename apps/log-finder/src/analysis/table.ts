/**
 * Grouping, filtering, sorting and per-row parameter diffs for the finder tables (upstream
 * LogFinder `setup_table`, `update_param_diff` and the Tabulator column calculations).
 */
import type { VehicleType } from '@apwt/dataflash'
import { paramDiff, type ParamDiff, type ParamIgnoreKey } from './param-diff.js'
import { guessSorter, tabulatorSort, type SortDirection, type SorterName, type SortValue } from './sorters.js'
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

/** Whether `key` is an array index, which a JavaScript object enumerates before other keys. */
function isArrayIndex(key: string): boolean {
  return /^(0|[1-9]\d*)$/.test(key) && Number(key) < 4294967295
}

/**
 * Split logs by flight controller. Groups come in upstream's `Object.entries(boards)` order: board
 * lines that are array indices (e.g. `"123"`) first in ascending order, then the rest in order of
 * first appearance.
 */
export function groupByBoard<F>(logs: readonly ScannedLog<F>[]): BoardGroup<F>[] {
  const groups = new Map<string, ScannedLog<F>[]>()
  for (const log of logs) {
    const key = log.summary.version.flightController ?? UNKNOWN_BOARD
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [log])
    else list.push(log)
  }
  const keys = [...groups.keys()]
  const ordered = [...keys.filter(isArrayIndex).sort((a, b) => Number(a) - Number(b)), ...keys.filter((k) => !isArrayIndex(k))]
  return ordered.map((board) => {
    const list = groups.get(board) ?? []
    return { board, commonPath: commonPath(list.map((l) => l.relativePath)), logs: list }
  })
}

// ----------------------------------------------------------------- sorting

/**
 * Sortable columns: upstream's. Parameter changes and actions are not sortable, as upstream; the
 * convenience vehicle column is not sortable either, because sorting decides which rows are diffed.
 */
export type SortKey = 'date' | 'name' | 'size' | 'firmware' | 'flightTime' | 'distance'

/** Which order the per-row parameter diffs were last computed in (see {@link BoardSort}). */
export type DiffOrder = 'sorted' | 'data'

/**
 * Sort state of one board's table. Upstream gives every board its own Tabulator table, so each
 * is sorted on its own.
 */
export interface BoardSort {
  readonly key: SortKey
  readonly direction: SortDirection
  /** Sorters Tabulator guessed for columns without one, fixed the first time each was sorted. */
  readonly sorters: Readonly<Partial<Record<SortKey, SorterName>>>
  /**
   * `sorted` after a sort: each row is diffed against the row above it. `data` after an ignore
   * option changes: upstream recomputes the diffs over `table.getRows()`, which is data (scan)
   * order, so each row is diffed against the log scanned before it until the table is sorted
   * again (upstream bug, reproduced).
   */
  readonly diffOrder: DiffOrder
}

/** Upstream's initial sort: `info.time_stamp` ascending with the `datetime` sorter. */
export const INITIAL_SORT: BoardSort = { key: 'date', direction: 'asc', sorters: {}, diffOrder: 'sorted' }

/** Column values as upstream's Tabulator rows hold them. */
const SORT_VALUES: Readonly<Record<SortKey, (s: ScannedLog<unknown>) => SortValue>> = {
  date: (l) => l.summary.startTime,
  name: (l) => l.name,
  size: (l) => l.summary.sizeBytes,
  firmware: (l) => l.summary.version.fwString,
  flightTime: (l) => l.summary.flightTimeS,
  // Upstream's `distance_traveled` is `null` (not undefined) without POS.
  distance: (l) => l.summary.distanceM ?? null
}

/** Columns with an explicit sorter; the others are guessed. */
const EXPLICIT_SORTERS: Readonly<Partial<Record<SortKey, SorterName>>> = { date: 'datetime' }

/** Sort a board's logs, given in data (scan) order, as its Tabulator table does. */
export function sortLogs<F>(logs: readonly ScannedLog<F>[], sort: BoardSort): ScannedLog<F>[] {
  const sorter = EXPLICIT_SORTERS[sort.key] ?? sort.sorters[sort.key] ?? guessSorter(logs[0] && SORT_VALUES[sort.key](logs[0]))
  return tabulatorSort(logs, SORT_VALUES[sort.key], sorter, sort.direction)
}

/**
 * Sort state after clicking a column header: toggle direction on the sorted column, else
 * ascending. A column without a sorter gets one guessed from the first displayed row.
 *
 * @param displayed The board's logs in their current display order.
 */
export function nextSort(current: BoardSort, key: SortKey, displayed: readonly ScannedLog<unknown>[]): BoardSort {
  const direction: SortDirection = current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
  let sorters = current.sorters
  if (EXPLICIT_SORTERS[key] === undefined && sorters[key] === undefined) {
    const first = displayed[0]
    sorters = { ...sorters, [key]: guessSorter(first && SORT_VALUES[key](first)) }
  }
  return { key, direction, sorters, diffOrder: 'sorted' }
}

/** Sort state after an ignore option changes (see {@link BoardSort.diffOrder}). */
export function afterIgnoreChange(current: BoardSort): BoardSort {
  return { ...current, diffOrder: 'data' }
}

// ----------------------------------------------------------------- filtering

/** Vehicle filter value: a vehicle family, or logs that do not identify one. */
export type VehicleFilterKey = VehicleType | 'unknown'

/** Filters applied to the scanned logs (a convenience: upstream lists every log; filters only hide rows). */
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

/** One table row: a log and its parameter changes since the log it is compared with. */
export interface TableRow<F> {
  readonly log: ScannedLog<F>
  /** `null` for the first row (in the diff order), which has nothing to compare with. */
  readonly paramDiff: ParamDiff | null
}

/** Column totals shown below a board's table when it has more than one log. */
export interface TableTotals {
  readonly sizeBytes: number
  /** Sum of flight times; unknown values count as zero, as Tabulator's `sum`. */
  readonly flightTimeS: number
  /** Sum of distances; logs without POS count as zero. */
  readonly distanceM: number
  /** Parameter changes from the first displayed row to the last (`total_param_diff_calc`). */
  readonly paramDiff: ParamDiff
}

/** A board's table after sorting, diffing and filtering. */
export interface BoardTable<F> {
  readonly board: string
  readonly commonPath: string
  /** Rows passing the filter, in display order. */
  readonly rows: readonly TableRow<F>[]
  /** Every log on the board in display order, shown or not (Tabulator's active rows). */
  readonly sorted: readonly ScannedLog<F>[]
  /** `null` when the board has a single log (upstream turns the calculation row off then). */
  readonly totals: TableTotals | null
}

/**
 * Diff each log's parameters against the one before it in `order` (upstream `update_param_diff`):
 * the first gets `null`.
 */
export function paramDiffsInOrder<F>(
  order: readonly ScannedLog<F>[],
  ignored: ReadonlySet<ParamIgnoreKey>
): Map<ScannedLog<F>, ParamDiff | null> {
  const out = new Map<ScannedLog<F>, ParamDiff | null>()
  order.forEach((log, i) => {
    const previous = i > 0 ? order[i - 1] : undefined
    out.set(log, previous === undefined ? null : paramDiff(log.summary.params, previous.summary.params, ignored))
  })
  return out
}

/** Totals for a board's sorted logs (upstream `bottomCalc` sums and `total_param_diff_calc`). */
export function tableTotals(sorted: readonly ScannedLog<unknown>[], ignored: ReadonlySet<ParamIgnoreKey>): TableTotals | null {
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (sorted.length <= 1 || first === undefined || last === undefined) return null
  let sizeBytes = 0
  let flightTimeS = 0
  let distanceM = 0
  for (const { summary } of sorted) {
    sizeBytes += summary.sizeBytes
    flightTimeS += summary.flightTimeS ?? 0
    distanceM += summary.distanceM ?? 0
  }
  return { sizeBytes, flightTimeS, distanceM, paramDiff: paramDiff(last.summary.params, first.summary.params, ignored) }
}

/**
 * Build the tables to show: logs grouped by board, each board sorted with its own state, diffed
 * and totalled over all of its logs as upstream does, then filtered. The filter only hides rows:
 * it never changes what a row is compared with or the totals. Boards with no visible logs are
 * dropped.
 */
export function buildTables<F>(
  logs: readonly ScannedLog<F>[],
  options: {
    readonly filter: LogFilter
    readonly sorts: ReadonlyMap<string, BoardSort>
    readonly ignored: ReadonlySet<ParamIgnoreKey>
  }
): BoardTable<F>[] {
  const out: BoardTable<F>[] = []
  for (const group of groupByBoard(logs)) {
    const sort = options.sorts.get(group.board) ?? INITIAL_SORT
    const sorted = sortLogs(group.logs, sort)
    const diffs = paramDiffsInOrder(sort.diffOrder === 'sorted' ? sorted : group.logs, options.ignored)
    const rows = sorted.filter((l) => matchesFilter(l, options.filter)).map((log) => ({ log, paramDiff: diffs.get(log) ?? null }))
    if (rows.length === 0) continue
    out.push({
      board: group.board,
      commonPath: group.commonPath,
      rows,
      sorted,
      totals: tableTotals(sorted, options.ignored)
    })
  }
  return out
}
