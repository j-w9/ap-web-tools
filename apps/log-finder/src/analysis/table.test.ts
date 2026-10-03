import { describe, expect, it } from 'vitest'
import {
  NO_FILTER,
  UNKNOWN_BOARD,
  buildTables,
  commonPath,
  groupByBoard,
  matchesFilter,
  nextSort,
  parseDateInput,
  sortLogs,
  tableTotals,
  withParamDiffs
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
})

describe('sorting', () => {
  const logs = [
    makeLog('c.bin', { startTime: t('2024-03-01'), sizeBytes: 3 }),
    makeLog('a.bin', { startTime: undefined, sizeBytes: 1 }),
    makeLog('b.bin', { startTime: t('2024-01-01'), sizeBytes: 2 })
  ]
  const names = (l: readonly { name: string }[]) => l.map((x) => x.name)

  it('puts missing values last in both directions', () => {
    expect(names(sortLogs(logs, { key: 'date', direction: 'asc' }))).toEqual(['b.bin', 'c.bin', 'a.bin'])
    expect(names(sortLogs(logs, { key: 'date', direction: 'desc' }))).toEqual(['c.bin', 'b.bin', 'a.bin'])
  })

  it('sorts names naturally and numbers numerically', () => {
    expect(names(sortLogs([makeLog('10.bin'), makeLog('9.bin')], { key: 'name', direction: 'asc' }))).toEqual(['9.bin', '10.bin'])
    expect(names(sortLogs(logs, { key: 'size', direction: 'desc' }))).toEqual(['c.bin', 'b.bin', 'a.bin'])
  })

  it('toggles direction on the same column', () => {
    expect(nextSort({ key: 'size', direction: 'asc' }, 'size')).toEqual({ key: 'size', direction: 'desc' })
    expect(nextSort({ key: 'size', direction: 'desc' }, 'name')).toEqual({ key: 'name', direction: 'asc' })
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

  it('diffs each row against the row above', () => {
    const rows = withParamDiffs(logs, ignored)
    expect(rows[0]?.paramDiff).toBeNull()
    expect([...(rows[1]?.paramDiff?.changed ?? [])]).toEqual([['A', { from: 1, to: 2 }]])
    expect([...(rows[2]?.paramDiff?.added ?? [])]).toEqual([['B', 1]])
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

  it('builds filtered, sorted tables and drops empty boards', () => {
    const tables = buildTables(logs, {
      filter: { ...NO_FILTER, text: '3.bin' },
      sort: { key: 'size', direction: 'desc' },
      ignored
    })
    expect(tables).toHaveLength(1)
    expect(tables[0]?.rows.map((r) => r.log.name)).toEqual(['3.bin'])
    expect(tables[0]?.totals).toBeNull()
    expect(
      buildTables(logs, { filter: { ...NO_FILTER, text: 'zzz' }, sort: { key: 'date', direction: 'asc' }, ignored })
    ).toEqual([])
  })
})
