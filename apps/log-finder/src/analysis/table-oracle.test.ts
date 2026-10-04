/**
 * Oracle tests for the table: row order from upstream's Tabulator sort module, per-row and total
 * parameter diffs from upstream `update_param_diff` / `total_param_diff_calc`, and the cell
 * formatters lifted verbatim from upstream `setup_table`.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import * as luxon from 'luxon'
import { ALL_PARAM_IGNORE_KEYS, type ParamDiff } from './param-diff.js'
import { formatDistance, formatFlightTime, formatSize } from './format.js'
import {
  INITIAL_SORT,
  buildTables,
  commonPath,
  nextSort,
  NO_FILTER,
  type BoardSort,
  type ScannedLog,
  type SortKey
} from './table.js'
import { makeLog } from './test-utils/summary.js'
import { UpstreamTable } from './test-utils/tabulator.js'
import { loadUpstreamLogFinder, type UpstreamDiff, type UpstreamLogFinder, type UpstreamRowData } from './test-utils/upstream.js'

let up: UpstreamLogFinder
beforeAll(async () => {
  up = await loadUpstreamLogFinder()
  up.param_diff_ignore.forEach((r) => (r.check.checked = true))
})

const FIELDS: Readonly<Record<SortKey, string>> = {
  date: 'info.time_stamp',
  name: 'info.name',
  size: 'info.size',
  firmware: 'info.fw_string',
  flightTime: 'info.flight_time',
  distance: 'info.distance_traveled'
}

function toUpstream(log: ScannedLog<string>): UpstreamRowData {
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

const asRecord = (d: ParamDiff | null): UpstreamDiff | null =>
  d === null
    ? null
    : {
        added: Object.fromEntries(d.added),
        missing: Object.fromEntries(d.missing),
        changed: Object.fromEntries([...d.changed].map(([k, v]) => [k, { ...v }]))
      }

const day = (n: number) => new Date(Date.UTC(2024, 0, 1 + n))
/** One board's logs in scan order, with awkward values: missing times, ties, unknown flight time. */
const LOGS: ScannedLog<string>[] = [
  makeLog('b/00000010.BIN', {
    startTime: day(3),
    sizeBytes: 300,
    flightTimeS: undefined,
    distanceM: 10,
    params: new Map([
      ['A', 1],
      ['STAT_FLTTIME', 5]
    ])
  }),
  makeLog('b/00000009.BIN', {
    startTime: undefined,
    sizeBytes: 300,
    flightTimeS: 0,
    distanceM: undefined,
    params: new Map([['A', 2]])
  }),
  makeLog('a/2.BIN', {
    startTime: day(1),
    sizeBytes: 2048,
    flightTimeS: 61,
    distanceM: 2500,
    params: new Map([
      ['A', 2],
      ['B', 1],
      ['STAT_FLTTIME', 9]
    ])
  }),
  makeLog('a/10.bin', { startTime: day(1), sizeBytes: 5, flightTimeS: 9, distanceM: 0, params: new Map([['B', 1]]) }),
  makeLog('c.bin', { startTime: undefined, sizeBytes: 0, flightTimeS: 3600, distanceM: 1999.999, params: new Map() })
]
const ignored = new Set(ALL_PARAM_IGNORE_KEYS)
const BOARD = 'CubeOrange 0033003A'

/** Run a sequence of header clicks on both, comparing order, per-row diffs and totals after each. */
async function compareClicks(clicks: readonly SortKey[], logs: readonly ScannedLog<string>[] = LOGS): Promise<void> {
  const data = logs.map(toUpstream)
  const table = await UpstreamTable.create(data)
  const redraw = { redraw: () => undefined }
  let sort: BoardSort = INITIAL_SORT
  let upDir: 'asc' | 'desc' = 'asc'
  let upField = FIELDS.date
  const check = (label: string) => {
    const rows = table.sort(upField, upDir)
    up.update_param_diff(redraw, rows)
    const [mine] = buildTables(logs, { filter: NO_FILTER, sorts: new Map([[BOARD, sort]]), ignored })
    expect(
      mine?.rows.map((r) => r.log.relativePath),
      label
    ).toEqual(rows.map((r) => r.getData().fileHandle.relativePath))
    expect(
      mine?.rows.map((r) => asRecord(r.paramDiff)),
      label
    ).toEqual(rows.map((r) => r.getData().param_diff))
    expect(asRecord(mine?.totals?.paramDiff ?? null), label).toEqual(
      up.formatters.total_param_diff_calc(
        [],
        rows.map((r) => r.getData())
      )
    )
  }
  check('initial sort')
  for (const key of clicks) {
    const field = FIELDS[key]
    upDir = upField === field && upDir === 'asc' ? 'desc' : 'asc'
    upField = field
    sort = nextSort(
      sort,
      key,
      buildTables(logs, { filter: NO_FILTER, sorts: new Map([[BOARD, sort]]), ignored })[0]?.sorted ?? []
    )
    check(`${key} ${upDir}`)
  }
}

describe('table sort and diffs oracle (Tabulator 6.2.1 + update_param_diff)', () => {
  it.each([
    [['date'] as SortKey[]],
    [['name', 'name'] as SortKey[]],
    [['size', 'size', 'date'] as SortKey[]],
    [['firmware'] as SortKey[]],
    [['flightTime', 'flightTime'] as SortKey[]],
    [['distance', 'distance', 'name'] as SortKey[]]
  ])('matches after clicking %j', async (clicks) => {
    await compareClicks(clicks)
  })

  it('keeps a guessed sorter after the first row changes', async () => {
    // First displayed row has a known flight time, so `number` is guessed and kept.
    await compareClicks(['size', 'flightTime', 'name', 'flightTime'], [...LOGS].reverse())
  })

  it('ignore option change: upstream re-diffs in data order (proven bug), the port in display order', async () => {
    const table = await UpstreamTable.create(LOGS.map(toUpstream))
    const sorted = table.sort(FIELDS.size, 'asc')
    const sort = nextSort(INITIAL_SORT, 'size', LOGS)
    const [mine] = buildTables(LOGS, { filter: NO_FILTER, sorts: new Map([[BOARD, sort]]), ignored })
    const minePaths = mine?.rows.map((r) => r.log.relativePath)
    const mineDiffs = mine?.rows.map((r) => asRecord(r.paramDiff))
    const diffsOf = (rows: typeof sorted) => {
      const byPath = new Map(rows.map((r) => [r.getData().fileHandle.relativePath, r.getData().param_diff]))
      return minePaths?.map((p) => byPath.get(p))
    }
    // Upstream's checkbox handler: update_param_diff(table, table.getRows()), data order (bug).
    up.update_param_diff({ redraw: () => undefined }, table.rows)
    const upstreamAfterToggle = diffsOf(table.rows)
    expect(upstreamAfterToggle?.[0]).not.toBeNull()
    expect(mineDiffs).not.toEqual(upstreamAfterToggle)
    // The port keeps upstream's display-order result (its dataSorted handler) for the same state.
    up.update_param_diff({ redraw: () => undefined }, sorted)
    expect(mineDiffs).toEqual(diffsOf(sorted))
    expect(mineDiffs?.[0]).toBeNull()
  })

  it('Flight Time with an unknown first flight time: upstream guesses string (proven bug), the port sorts numbers', async () => {
    // Scan order puts the log without a flight time first; sorting by size asc keeps it first.
    const logs = [
      makeLog('x.bin', { startTime: day(1), sizeBytes: 1, flightTimeS: undefined }),
      makeLog('y.bin', { startTime: day(2), sizeBytes: 2, flightTimeS: 300 }),
      makeLog('z.bin', { startTime: day(3), sizeBytes: 3, flightTimeS: 60 })
    ]
    const guessed = await UpstreamTable.create(logs.map(toUpstream))
    guessed.sort(FIELDS.size, 'asc')
    const upstreamOrder = guessed.sort(FIELDS.flightTime, 'asc').map((r) => r.getData().fileHandle.relativePath)
    expect(upstreamOrder).toEqual(['x.bin', 'y.bin', 'z.bin'])

    let sort = nextSort(INITIAL_SORT, 'size', logs)
    sort = nextSort(
      sort,
      'flightTime',
      buildTables(logs, { filter: NO_FILTER, sorts: new Map([[BOARD, sort]]), ignored })[0]?.sorted ?? []
    )
    for (const dir of ['asc', 'desc'] as const) {
      const numeric = await UpstreamTable.create(logs.map(toUpstream))
      numeric.useSorter(FIELDS.flightTime, 'number')
      const expected = numeric.sort(FIELDS.flightTime, dir).map((r) => r.getData().fileHandle.relativePath)
      const [mine] = buildTables(logs, { filter: NO_FILTER, sorts: new Map([[BOARD, { ...sort, direction: dir }]]), ignored })
      expect(
        mine?.rows.map((r) => r.log.relativePath),
        dir
      ).toEqual(expected)
    }
    expect(
      buildTables(logs, { filter: NO_FILTER, sorts: new Map([[BOARD, sort]]), ignored })[0]?.rows.map((r) => r.log.name)
    ).toEqual(['x.bin', 'z.bin', 'y.bin'])
  })
})

describe('formatters oracle (lifted from setup_table)', () => {
  const cell = (info: Record<string, unknown>) => ({
    getRow: () => ({ getData: () => ({ info: { params: {}, ...info }, fileHandle: { relativePath: '', name: '' } }) })
  })

  it('size_format', () => {
    for (const size of [0, 1, 1023, 1024, 1536, 1048575, 1048576, 5 * 1024 ** 3, 3 * 1024 ** 4, 1023 * 1024 ** 4, 123456789]) {
      expect(formatSize(size), String(size)).toBe(up.formatters.size_format(cell({ size })))
    }
  })

  it('size_format from 1024 TB: upstream prints undefined (proven bug), the port clamps to TB', () => {
    for (const [size, port] of [
      [1024 ** 5 - 1, '1024.00 TB'],
      [1024 ** 5, '1024.00 TB'],
      [2 * 1024 ** 5, '2048.00 TB']
    ] as const) {
      expect(up.formatters.size_format(cell({ size })), String(size)).toMatch(/ undefined$/)
      expect(formatSize(size), String(size)).toBe(port)
    }
  })

  it('flight_time_format', () => {
    for (const t of [
      undefined,
      0,
      0.4,
      1,
      45,
      59.6,
      60,
      61,
      3599,
      3600,
      3725,
      86400,
      8 * 86400,
      40 * 86400,
      400 * 86400,
      12.345,
      -30
    ]) {
      expect(formatFlightTime(t), String(t)).toBe(up.formatters.flight_time_format(cell({ flight_time: t })))
    }
  })

  it('get_dist_string', () => {
    for (const d of [undefined, 0, 1.005, 1999.994, 1999.996, 2000, 2500, 123456.789]) {
      expect(formatDistance(d), String(d)).toBe(up.formatters.get_dist_string(cell({ distance_traveled: d ?? null })))
    }
  })

  it('get_common_path', () => {
    const groups = [['logs/a/1.bin', 'logs/a/2.bin', 'logs/b.bin'], ['x/1.bin'], ['a.bin', 'b.bin'], ['a/1.bin', 'a/1.bin']]
    for (const paths of groups) {
      const data = paths.map((p) => ({ info: { params: {} }, fileHandle: { relativePath: p, name: p } }))
      expect(commonPath(paths)).toBe(up.formatters.get_common_path(data))
    }
  })
})
