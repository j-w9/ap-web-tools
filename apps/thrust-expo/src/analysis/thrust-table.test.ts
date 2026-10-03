import { describe, expect, it } from 'vitest'
import {
  COLUMNS,
  EMPTY_ROW,
  EXAMPLE_SAMPLES,
  applyPaste,
  clearRange,
  copyRange,
  editCell,
  emptyRows,
  isUsableRow,
  rowsFromSamples,
  thrustData,
  type CellValue,
  type TableRow
} from './thrust-table.js'
import { loadUpstreamPage, type UpstreamRow } from './test-support/upstream.js'

function row(pwm: CellValue, thrust: CellValue, voltage: CellValue = '', current: CellValue = ''): TableRow {
  return { pwm, thrust, voltage, current }
}

describe('usable rows match upstream', () => {
  // Every kind of value a cell can hold upstream: typed text, pasted numbers (incl. NaN and 0),
  // numeric example data and cleared (undefined) cells.
  const rows: TableRow[] = [
    row('1000', '0.1'),
    row(1100, 0.2),
    row('0', '0.3'),
    row(0, 0.35),
    row(1200, 0),
    row('1250', '0'),
    row(Number.NaN, 0.4),
    row(undefined, '0.5'),
    row(' 1300 ', '0.6 '),
    row('0x10', '0.7'),
    row('1e3', 'Infinity'),
    row('', '0.8'),
    row('12abc', '0.9')
  ]

  it('keeps the same rows and plots the same raw values against PWM', () => {
    const page = loadUpstreamPage()
    page.setRows(rows.map((r) => ({ ...r })))
    page.api.updatePlotData()
    const pwmPlot = page.api.thrustPwmPlot.data[0]!
    const used = rows.filter(isUsableRow)
    expect(Array.from(pwmPlot.x)).toEqual(used.map((r) => r.pwm))
    expect(Array.from(pwmPlot.y)).toEqual(used.map((r) => r.thrust))
    // Upstream bug: numeric 0 drops the row, typed "0" keeps it.
    expect(used.map((r) => r.pwm)).toEqual(['1000', 1100, '0', '1250', ' 1300 ', '0x10', '1e3'])
  })

  it('parses the kept values with parseFloat, as upstream', () => {
    const d = thrustData(rows)
    // "0x10" passes isNaN (it is 16) but parseFloat reads 0, as upstream.
    expect(Array.from(d.pwm)).toEqual([1000, 1100, 0, 1250, 1300, 0, 1000])
    expect(Array.from(d.thrust)).toEqual([0.1, 0.2, 0.3, 0, 0.6, 0.7, Infinity])
  })

  it('keeps the example data numeric, so its rows are all used', () => {
    const data = thrustData(rowsFromSamples(EXAMPLE_SAMPLES))
    expect(Array.from(data.pwm)).toEqual(EXAMPLE_SAMPLES.map((s) => s.pwm))
    expect(Array.from(data.thrust)).toEqual(EXAMPLE_SAMPLES.map((s) => s.thrust))
  })
})

describe('editCell', () => {
  it('rejects what the numeric validator rejects', () => {
    expect(editCell(emptyRows(2), 0, 'pwm', 'abc').kind).toBe('invalid')
    expect(editCell(emptyRows(2), 0, 'pwm', '12g').kind).toBe('invalid')
    expect(editCell(emptyRows(2), 0, 'pwm', ' 12 ').kind).toBe('changed')
    expect(editCell(emptyRows(2), 0, 'pwm', '').kind).toBe('unchanged')
  })

  it('writes text, grows the table when the last row is edited, and writes "5" over a numeric 5', () => {
    const a = editCell(emptyRows(2), 0, 'pwm', '1000')
    expect(a.kind === 'changed' && a.rows).toEqual([{ ...EMPTY_ROW, pwm: '1000' }, EMPTY_ROW])
    const b = editCell(emptyRows(2), 1, 'thrust', '0.2')
    expect(b.kind === 'changed' && b.rows).toEqual([EMPTY_ROW, { ...EMPTY_ROW, thrust: '0.2' }, EMPTY_ROW])
    const c = editCell([row(5, 1)], 0, 'pwm', '5')
    expect(c.kind === 'changed' && c.rows[0]).toEqual(row('5', 1))
    // A cleared (undefined) cell committed empty becomes "" (a change).
    expect(editCell([row(undefined, 1), EMPTY_ROW], 0, 'pwm', '').kind).toBe('changed')
  })
})

describe('applyPaste', () => {
  /** Upstream: the page's paste parser (adds rows, returns parsed rows); Tabulator's range action then writes them. */
  function upstreamPaste(rows: TableRow[], top: number, left: number, text: string): UpstreamRow[] {
    const page = loadUpstreamPage()
    page.setRows(rows.map((r) => ({ ...r })))
    const parsed = page.pasteParser(text, top, left)
    const table = page.rows()
    // Tabulator `pasteActions.range` with a single selected cell: one row per parsed line.
    parsed.forEach((p, i) => {
      const target = table[top + i]
      if (target) Object.assign(target, p)
    })
    return table
  }

  const cases: { name: string; top: number; left: number; text: string }[] = [
    { name: 'a range with extra columns and CRLF', top: 1, left: 1, text: '0.5\t16.1\t2\textra\r\n0.6\t\t3\n' },
    { name: 'unreadable values', top: 0, left: 0, text: 'abc\t1\n1200\tx' },
    { name: 'a single value', top: 3, left: 2, text: '16.2' },
    { name: 'empty text', top: 0, left: 0, text: '' },
    { name: 'past the end of the table', top: 1, left: 0, text: '1000\t0.1\n1100\t0.2\n1200\t0.3\n1300\t0.4' }
  ]
  for (const c of cases) {
    it(`matches upstream for ${c.name}`, () => {
      const rows = emptyRows(4)
      const range = { top: c.top, bottom: c.top, left: c.left, right: c.left }
      expect(applyPaste(rows, range, c.text)).toEqual(upstreamPaste(rows, c.top, c.left, c.text))
    })
  }

  it('stores NaN for unreadable values (shown as "NaN")', () => {
    const next = applyPaste(emptyRows(2), { top: 0, bottom: 0, left: 0, right: 0 }, 'abc')
    expect(next[0]?.pwm).toBeNaN()
  })

  it('fills a selected range of rows, repeating the pasted lines (Tabulator range action)', () => {
    const next = applyPaste(emptyRows(6), { top: 1, bottom: 4, left: 0, right: 1 }, '1\t2\n3\t4')
    expect(next.slice(0, 6).map((r) => [r.pwm, r.thrust])).toEqual([
      ['', ''],
      [1, 2],
      [3, 4],
      [1, 2],
      [3, 4],
      ['', '']
    ])
    // A range shorter than the paste truncates it, but rows are still added for the whole paste.
    const short = applyPaste(emptyRows(2), { top: 0, bottom: 1, left: 0, right: 0 }, '1\n2\n3\n4')
    expect(short.map((r) => r.pwm)).toEqual([1, 2, '', '', ''])
  })
})

describe('clearRange and copyRange', () => {
  const rows: TableRow[] = [row(1000, 0.1, 16, 1), row('1100', '0.2'), row(Number.NaN, undefined)]

  it('clears to undefined and grows the table when the last row changes', () => {
    const cleared = clearRange(rows, { top: 1, bottom: 2, left: 0, right: 1 })
    expect(cleared).toEqual([rows[0], row(undefined, undefined), row(undefined, undefined), EMPTY_ROW])
    expect(clearRange(rows, { top: 0, bottom: 0, left: 0, right: 0 })).toHaveLength(3)
    expect(clearRange([row(undefined, undefined)], { top: 0, bottom: 0, left: 0, right: 1 })).toBeNull()
  })

  it('copies a range as tab-separated text', () => {
    expect(copyRange(rows, { top: 0, bottom: 2, left: 0, right: COLUMNS.length - 1 })).toBe(
      '1000\t0.1\t16\t1\n1100\t0.2\t\t\nNaN\t\t\t'
    )
    expect(copyRange(rows, { top: 1, bottom: 1, left: 1, right: 1 })).toBe('0.2')
  })
})
