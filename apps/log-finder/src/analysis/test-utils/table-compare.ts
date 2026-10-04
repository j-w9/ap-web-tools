// Test-only: drive the port's tables and upstream's (Tabulator sort module + update_param_diff +
// total_param_diff_calc) through the same header clicks and compare order, per-row diffs and totals.
import { expect } from 'vitest'
import * as luxon from 'luxon'
import type { ParamDiff, ParamIgnoreKey } from '../param-diff.js'
import { INITIAL_SORT, buildTables, nextSort, NO_FILTER, type BoardSort, type ScannedLog, type SortKey } from '../table.js'
import { UpstreamTable } from './tabulator.js'
import type { UpstreamDiff, UpstreamLogFinder, UpstreamRowData } from './upstream.js'

/** Upstream Tabulator field of each sortable column. */
export const FIELDS: Readonly<Record<SortKey, string>> = {
  date: 'info.time_stamp',
  name: 'info.name',
  size: 'info.size',
  firmware: 'info.fw_string',
  flightTime: 'info.flight_time',
  distance: 'info.distance_traveled'
}

/** A scanned log as upstream's row data. */
export function toUpstream(log: ScannedLog<unknown>): UpstreamRowData {
  const s = log.summary
  return {
    info: {
      time_stamp: luxon.DateTime.fromJSDate(s.startTime as Date),
      name: log.name,
      size: s.sizeBytes,
      fw_string: s.version.fwString,
      flight_time: s.flightTimeS,
      distance_traveled: s.distanceM ?? null,
      params: Object.fromEntries(s.params)
    },
    fileHandle: { relativePath: log.relativePath, name: log.name }
  }
}

/** A port diff in upstream's shape. */
export function diffRecord(d: ParamDiff | null): UpstreamDiff | null {
  return d === null
    ? null
    : {
        added: Object.fromEntries(d.added),
        missing: Object.fromEntries(d.missing),
        changed: Object.fromEntries([...d.changed].map(([k, v]) => [k, { ...v }]))
      }
}

/**
 * Run a sequence of header clicks on one board's table in both, comparing order, per-row diffs and
 * totals after the initial sort and after each click. `logs` are that board's logs in scan order.
 *
 * With `numericFlightTime`, upstream's Flight Time column gets the `number` sorter when its guess
 * would see an unknown first flight time: the port's proven fix (docs/bug-proofs/log-finder.md).
 */
export async function compareClicks(
  up: UpstreamLogFinder,
  logs: readonly ScannedLog<unknown>[],
  board: string,
  clicks: readonly SortKey[],
  ignored: ReadonlySet<ParamIgnoreKey>,
  numericFlightTime = false
): Promise<void> {
  const table = await UpstreamTable.create(logs.map(toUpstream))
  const redraw = { redraw: () => undefined }
  let sort: BoardSort = INITIAL_SORT
  let upDir: 'asc' | 'desc' = 'asc'
  let upField = FIELDS.date
  let flightTimeSorted = false
  const check = (label: string) => {
    const rows = table.sort(upField, upDir)
    up.update_param_diff(redraw, rows)
    const mine = buildTables(logs, { filter: NO_FILTER, sorts: new Map([[board, sort]]), ignored }).find((t) => t.board === board)
    expect(
      mine?.rows.map((r) => r.log.relativePath),
      label
    ).toEqual(rows.map((r) => r.getData().fileHandle.relativePath))
    expect(
      mine?.rows.map((r) => diffRecord(r.paramDiff)),
      label
    ).toEqual(rows.map((r) => r.getData().param_diff))
    expect(diffRecord(mine?.totals?.paramDiff ?? null), label).toEqual(
      up.formatters.total_param_diff_calc(
        [],
        rows.map((r) => r.getData())
      )
    )
  }
  check('initial sort')
  for (const key of clicks) {
    const field = FIELDS[key]
    if (numericFlightTime && key === 'flightTime' && !flightTimeSorted) {
      flightTimeSorted = true
      if (typeof table.active[0]?.getData().info['flight_time'] !== 'number') table.useSorter(field, 'number')
    }
    upDir = upField === field && upDir === 'asc' ? 'desc' : 'asc'
    upField = field
    const displayed = buildTables(logs, { filter: NO_FILTER, sorts: new Map([[board, sort]]), ignored }).find(
      (t) => t.board === board
    )
    sort = nextSort(sort, key, displayed?.sorted ?? [])
    check(`${key} ${upDir}`)
  }
}
