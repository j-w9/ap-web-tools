import { describe, expect, it } from 'vitest'
import {
  INITIAL_SORT,
  NO_FILTER,
  UNKNOWN_BOARD,
  afterIgnoreChange,
  buildTables,
  commonPath,
  groupByBoard,
  matchesFilter,
  nextSort,
  parseDateInput,
  sortLogs,
  paramDiffsInOrder,
  tableTotals,
  type BoardSort
} from './table.js'
import { ALL_PARAM_IGNORE_KEYS } from './param-diff.js'
import { makeLog, makeSummary } from './test-utils/summary.js'

const t = (iso: string) => new Date(iso)

describe('commonPath', () => {
  it('is the character-wise common prefix, or the whole path for one log', () => {
    expect(commonPath(['logs/a/1.bin', 'logs/a/2.bin', 'logs/b.bin'])).toBe('logs/')
    expect(commonPath(['x/1.bin'])).toBe('x/1.bin')
    expect(commonPath(['a.bin', 'b.bin'])).toBe('')
    expect(commonPath([])).toBe('')
  })
})

describe('groupByBoard', () => {
  it('groups by boot board line in order of first appearance', () => {
    const unknown = makeSummary().version
    const groups = groupByBoard([
      makeLog('a/1.bin'),
      makeLog('b/1.bin', { version: { ...unknown, flightController: undefined } }),
      makeLog('a/2.bin')
    ])
    expect(groups.map((g) => [g.board, g.commonPath, g.logs.length])).toEqual([
      ['CubeOrange 0033003A', 'a/', 2],
      [UNKNOWN_BOARD, 'b/1.bin', 1]
    ])
  })

  it('puts array-index board lines first, ascending, as upstream object keys enumerate', () => {
    const v = makeSummary().version
    const logs = ['Z', '20', 'A', '3'].map((fc) => makeLog(`${fc}.bin`, { version: { ...v, flightController: fc } }))
    expect(groupByBoard(logs).map((g) => g.board)).toEqual(['3', '20', 'Z', 'A'])
  })
})

describe('sorting (Tabulator semantics)', () => {
  const logs = [
    makeLog('c.bin', { startTime: t('2024-03-01'), sizeBytes: 3 }),
    makeLog('a.bin', { startTime: undefined, sizeBytes: 1 }),
    makeLog('b.bin', { startTime: t('2024-01-01'), sizeBytes: 2 })
  ]
  const names = (l: readonly { name: string }[]) => l.map((x) => x.name)
  const by = (key: BoardSort['key'], direction: BoardSort['direction']): BoardSort => ({ ...INITIAL_SORT, key, direction })

  it('puts logs without GPS time first ascending and last descending', () => {
    expect(names(sortLogs(logs, by('date', 'asc')))).toEqual(['a.bin', 'b.bin', 'c.bin'])
    expect(names(sortLogs(logs, by('date', 'desc')))).toEqual(['c.bin', 'b.bin', 'a.bin'])
  })

  it('guesses sorters from the first displayed row and keeps them', () => {
    // Names guess `string`: "10.bin" sorts before "9.bin".
    expect(names(sortLogs([makeLog('9.bin'), makeLog('10.bin')], by('name', 'asc')))).toEqual(['10.bin', '9.bin'])
    const size = nextSort(INITIAL_SORT, 'size', logs)
    expect(size).toEqual({ key: 'size', direction: 'asc', sorters: { size: 'number' }, diffOrder: 'sorted' })
    expect(names(sortLogs(logs, { ...size, direction: 'desc' }))).toEqual(['c.bin', 'b.bin', 'a.bin'])
    // An unknown flight time in the first row makes Tabulator compare flight times as strings.
    const ft = [makeLog('x.bin'), makeLog('y.bin', { flightTimeS: 300 }), makeLog('z.bin', { flightTimeS: 60 })]
    const ftSort = nextSort(INITIAL_SORT, 'flightTime', ft)
    expect(ftSort.sorters.flightTime).toBe('string')
    expect(names(sortLogs(ft, ftSort))).toEqual(['x.bin', 'y.bin', 'z.bin'])
  })

  it('toggles direction on the same column', () => {
    const size = nextSort(INITIAL_SORT, 'size', logs)
    expect(nextSort(size, 'size', logs).direction).toBe('desc')
    expect(nextSort(nextSort(size, 'size', logs), 'size', logs).direction).toBe('asc')
    expect(nextSort(size, 'name', logs).direction).toBe('asc')
  })
})

describe('filtering', () => {
  const log = makeLog('flights/field/00000042.BIN', {
    startTime: t('2024-06-15T12:00:00'),
    flightTimeS: 300,
    vehicle: 'plane'
  })

  it('matches text against path and firmware case-insensitively', () => {
    expect(matchesFilter(log, { ...NO_FILTER, text: 'FIELD' })).toBe(true)
    expect(matchesFilter(log, { ...NO_FILTER, text: 'v4.6' })).toBe(true)
    expect(matchesFilter(log, { ...NO_FILTER, text: 'rover' })).toBe(false)
  })

  it('hides vehicles, unflown logs and logs without warnings', () => {
    expect(matchesFilter(log, { ...NO_FILTER, hiddenVehicles: new Set(['plane']) })).toBe(false)
    expect(matchesFilter(makeLog('x.bin', { vehicle: undefined }), { ...NO_FILTER, hiddenVehicles: new Set(['unknown']) })).toBe(
      false
    )
    expect(matchesFilter(log, { ...NO_FILTER, flownOnly: true })).toBe(true)
    expect(matchesFilter(makeLog('x.bin', { flightTimeS: 0 }), { ...NO_FILTER, flownOnly: true })).toBe(false)
    expect(matchesFilter(log, { ...NO_FILTER, warningsOnly: true })).toBe(false)
    expect(matchesFilter(makeLog('x.bin', { watchdog: true }), { ...NO_FILTER, warningsOnly: true })).toBe(true)
  })

  it('limits by local date range and hides logs without GPS time', () => {
    const range = { from: parseDateInput('2024-06-15'), to: parseDateInput('2024-06-15', true) }
    expect(matchesFilter(log, { ...NO_FILTER, ...range })).toBe(true)
    expect(matchesFilter(log, { ...NO_FILTER, from: parseDateInput('2024-06-16') })).toBe(false)
    expect(matchesFilter(makeLog('x.bin'), { ...NO_FILTER, ...range })).toBe(false)
  })

  it('parses date inputs', () => {
    expect(parseDateInput('')).toBeUndefined()
    expect(parseDateInput('2024-06-15')?.getHours()).toBe(0)
    expect(parseDateInput('2024-06-15', true)?.getMilliseconds()).toBe(999)
  })
})

describe('rows and totals', () => {
  const logs = [
    makeLog('1.bin', { params: new Map([['A', 1]]), sizeBytes: 10, flightTimeS: 60, distanceM: 5 }),
    makeLog('2.bin', { params: new Map([['A', 2]]), sizeBytes: 20, flightTimeS: undefined, distanceM: undefined }),
    makeLog('3.bin', {
      params: new Map([
        ['A', 2],
        ['B', 1]
      ]),
      sizeBytes: 30,
      flightTimeS: 30,
      distanceM: 1
    })
  ]
  const ignored = new Set(ALL_PARAM_IGNORE_KEYS)

  it('diffs each row against the one before it in the given order', () => {
    const diffs = paramDiffsInOrder(logs, ignored)
    expect(diffs.get(logs[0]!)).toBeNull()
    expect([...(diffs.get(logs[1]!)?.changed ?? [])]).toEqual([['A', { from: 1, to: 2 }]])
    expect([...(diffs.get(logs[2]!)?.added ?? [])]).toEqual([['B', 1]])
  })

  it('totals sizes, times and distances, and diffs last against first', () => {
    const totals = tableTotals(logs, ignored)
    expect(totals?.sizeBytes).toBe(60)
    expect(totals?.flightTimeS).toBe(90)
    expect(totals?.distanceM).toBe(6)
    expect(totals?.paramDiff.changed.size).toBe(1)
    expect(totals?.paramDiff.added.size).toBe(1)
    expect(tableTotals(logs.slice(0, 1), ignored)).toBeNull()
  })

  it('filters only hide rows: diffs and totals are over every log of the board', () => {
    const sorts = new Map([['CubeOrange 0033003A', { ...INITIAL_SORT, key: 'size' as const, direction: 'desc' as const }]])
    const tables = buildTables(logs, { filter: { ...NO_FILTER, text: '1.bin' }, sorts, ignored })
    expect(tables).toHaveLength(1)
    expect(tables[0]?.rows.map((r) => r.log.name)).toEqual(['1.bin'])
    // Sorted 3, 2, 1: row 1 is compared with 2.bin even though 2.bin is hidden.
    expect([...(tables[0]?.rows[0]?.paramDiff?.changed ?? [])]).toEqual([['A', { from: 2, to: 1 }]])
    expect(tables[0]?.totals?.sizeBytes).toBe(60)
    expect(buildTables(logs, { filter: { ...NO_FILTER, text: 'zzz' }, sorts, ignored })).toEqual([])
  })

  it('diffs in data order after an ignore change until the next sort (upstream bug)', () => {
    const sorts = new Map([['CubeOrange 0033003A', afterIgnoreChange({ ...INITIAL_SORT, key: 'size', direction: 'desc' })]])
    const rows = buildTables(logs, { filter: NO_FILTER, sorts, ignored })[0]?.rows ?? []
    expect(rows.map((r) => r.log.name)).toEqual(['3.bin', '2.bin', '1.bin'])
    expect(rows[2]?.paramDiff).toBeNull()
    expect([...(rows[1]?.paramDiff?.changed ?? [])]).toEqual([['A', { from: 1, to: 2 }]])
  })
})
