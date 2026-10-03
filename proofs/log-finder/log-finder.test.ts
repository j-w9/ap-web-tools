/**
 * Log Finder: reproductions of the rows in docs/upstream-bugs.md, run against the original
 * LogFinder.js and the original Tabulator 6.2.1 sort/row code (see `_harness.ts`).
 * Verdicts: docs/bug-proofs/log-finder.md.
 */
import { describe, expect, it } from 'vitest'
import { dateTime, loadLogFinder, logRow, type FakeTabulator, type RowData } from './_harness.js'

const paths = (rows: { getData(): RowData }[]): string[] => rows.map((r) => r.getData().fileHandle.relativePath)
const diffs = (t: FakeTabulator): [string, RowData['param_diff']][] =>
  t.displayed().map((r) => [r.getData().fileHandle.relativePath, r.getData().param_diff])

function onlyTable(tables: FakeTabulator[]): FakeTabulator {
  const [t] = tables
  if (t === undefined || tables.length !== 1) throw new Error('expected one table')
  return t
}

describe('Log Finder', () => {
  it('1. an ignore checkbox toggle re-diffs rows in data order, not display order', async () => {
    const page = await loadLogFinder()
    // Scan (data) order c, a, b; dates put them in display order a, b, c.
    page.setupTable({
      'c.bin': logRow('c.bin', { time_stamp: dateTime('2024-01-03T00:00:00Z'), params: { X: 1, Y: 1 } }),
      'a.bin': logRow('a.bin', { time_stamp: dateTime('2024-01-01T00:00:00Z'), params: { X: 1 } }),
      'b.bin': logRow('b.bin', { time_stamp: dateTime('2024-01-02T00:00:00Z'), params: { X: 1, Y: 1 } })
    })
    const table = onlyTable(page.tables)
    const none = { added: {}, missing: {}, changed: {} }

    // After the initial date sort (`dataSorted` → update_param_diff(table, rows)): each row is
    // diffed against the row displayed above it.
    expect(paths(table.displayed())).toEqual(['a.bin', 'b.bin', 'c.bin'])
    expect(diffs(table)).toEqual([
      ['a.bin', null],
      ['b.bin', { ...none, added: { Y: 1 } }],
      ['c.bin', none]
    ])

    // Untick and re-tick the first ignore option: the ignore state is back where it started.
    const check = page.ignoreChecks[0]!
    check.checked = false
    check.dispatch('change')
    check.checked = true
    check.dispatch('change')

    // `table.getRows()` is data order, so with the same ignore state and the same display order
    // the Param Changes column now differs: the top row shows a diff against the bottom one.
    expect(paths(table.getRows())).toEqual(['c.bin', 'a.bin', 'b.bin'])
    expect(paths(table.displayed())).toEqual(['a.bin', 'b.bin', 'c.bin'])
    expect(diffs(table)).toEqual([
      ['a.bin', { ...none, missing: { Y: 1 } }],
      ['b.bin', { ...none, added: { Y: 1 } }],
      ['c.bin', null]
    ])

    // The next sort restores display-order diffs.
    table.setSort('info.time_stamp', 'asc')
    expect(diffs(table)).toEqual([
      ['a.bin', null],
      ['b.bin', { ...none, added: { Y: 1 } }],
      ['c.bin', none]
    ])
  })

  describe('2. Flight Time sorter guessed from the first displayed row', () => {
    const logs = (firstFlightTime: number | undefined): Record<string, RowData> => ({
      'first.bin': logRow('first.bin', {
        time_stamp: dateTime('2024-01-01T00:00:00Z'),
        ...(firstFlightTime === undefined ? {} : { flight_time: firstFlightTime })
      }),
      'five-min.bin': logRow('five-min.bin', { time_stamp: dateTime('2024-01-02T00:00:00Z'), flight_time: 300 }),
      'one-min.bin': logRow('one-min.bin', { time_stamp: dateTime('2024-01-03T00:00:00Z'), flight_time: 60 })
    })

    it('first displayed log without STAT_FLTTIME: string sorter, 300 s before 60 s ascending', async () => {
      const page = await loadLogFinder()
      page.setupTable(logs(undefined))
      const table = onlyTable(page.tables)
      table.setSort('info.flight_time', 'asc')
      expect(paths(table.displayed())).toEqual(['first.bin', 'five-min.bin', 'one-min.bin'])
      expect(table.sorterName('info.flight_time')).toBe('string')
      // The guess is kept: still string order after re-sorting from another column.
      table.setSort('info.size', 'asc')
      table.setSort('info.flight_time', 'desc')
      expect(paths(table.displayed())).toEqual(['one-min.bin', 'five-min.bin', 'first.bin'])
    })

    it('same column, first displayed log with a flight time: number sorter, 60 s before 300 s', async () => {
      const page = await loadLogFinder()
      page.setupTable(logs(10))
      const table = onlyTable(page.tables)
      table.setSort('info.flight_time', 'asc')
      expect(table.sorterName('info.flight_time')).toBe('number')
      expect(paths(table.displayed())).toEqual(['first.bin', 'one-min.bin', 'five-min.bin'])
    })
  })

  it('3. Name column sorts 10.BIN before 9.BIN (guessed string sorter)', async () => {
    const page = await loadLogFinder()
    page.setupTable({
      '9.BIN': logRow('9.BIN', { time_stamp: dateTime('2024-01-01T00:00:00Z') }),
      '10.BIN': logRow('10.BIN', { time_stamp: dateTime('2024-01-02T00:00:00Z') })
    })
    const table = onlyTable(page.tables)
    table.setSort('info.name', 'asc')
    expect(table.sorterName('info.name')).toBe('string')
    expect(paths(table.displayed())).toEqual(['10.BIN', '9.BIN'])
  })

  it('4. size_format has no unit from 1024 TB', async () => {
    const page = await loadLogFinder()
    page.setupTable({ 'a.bin': logRow('a.bin') })
    const format = onlyTable(page.tables).formatter('info.size')
    const cell = (size: number) => ({ getRow: () => ({ getData: () => logRow('a.bin', { size }) }) })
    // The formatter closure Tabulator received from setup_table, called as Tabulator calls it.
    const fmt = (size: number): unknown => format.call(undefined, cell(size) as never)
    expect(fmt(1024 ** 4)).toBe('1.00 TB')
    expect(fmt(1000 * 1024 ** 4)).toBe('1000.00 TB')
    // log(1024^5 - 1) / log(1024) rounds to 5 in floating point, so one byte short already hits it.
    expect(fmt(1024 ** 5 - 1)).toBe('1.00 undefined')
    expect(fmt(1024 ** 5)).toBe('1.00 undefined')
    expect(fmt(3 * 1024 ** 6)).toBe('3.00 undefined')
  })

  it('5. a board named like an array index gets the first table', async () => {
    const page = await loadLogFinder()
    page.setupTable({
      'a.bin': logRow('a.bin', { fc_string: 'CubeOrange 0033003A' }),
      'b.bin': logRow('b.bin', { fc_string: '123' }),
      'c.bin': logRow('c.bin')
    })
    const summaries = page.document
      .getElementById('tables')
      .children.map((details) => details.children.find((c) => c.nodeName === 'summary')?.textContent)
    expect(summaries).toEqual(['123: b.bin', 'CubeOrange 0033003A: a.bin', 'Unknown: c.bin'])
  })
})
