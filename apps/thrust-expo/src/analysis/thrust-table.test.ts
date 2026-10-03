import { describe, expect, it } from 'vitest'
import { EMPTY_ROW, applyPaste, cellValue, editCell, emptyRows, isRangePaste, thrustData } from './thrust-table.js'

describe('cellValue', () => {
  it('accepts finite numbers, including 0', () => {
    expect(cellValue(' 1500 ')).toBe(1500)
    expect(cellValue('0')).toBe(0)
    expect(cellValue('')).toBeNull()
    expect(cellValue('  ')).toBeNull()
    expect(cellValue('12g')).toBeNull()
    expect(cellValue('Infinity')).toBeNull()
  })
})

describe('thrustData', () => {
  it('keeps rows with a valid signal and thrust, in order', () => {
    const rows = [
      { pwm: '1000', thrust: '0.1', voltage: '', current: '' },
      { pwm: '1100', thrust: '', voltage: '16', current: '1' },
      { pwm: 'x', thrust: '0.3', voltage: '', current: '' },
      { pwm: '1200', thrust: '0.4', voltage: '', current: '' }
    ]
    const d = thrustData(rows)
    expect(Array.from(d.pwm)).toEqual([1000, 1200])
    expect(Array.from(d.thrust)).toEqual([0.1, 0.4])
  })
})

describe('editCell', () => {
  it('sets a cell and grows the table when the last row is edited', () => {
    const rows = emptyRows(2)
    const a = editCell(rows, 0, 'pwm', '1000')
    expect(a).toHaveLength(2)
    expect(a[0]).toEqual({ ...EMPTY_ROW, pwm: '1000' })
    const b = editCell(a, 1, 'thrust', '0.2')
    expect(b).toHaveLength(3)
    expect(b[2]).toEqual(EMPTY_ROW)
  })
})

describe('applyPaste', () => {
  it('fills a range from the target cell and leaves one empty row after it', () => {
    const rows = emptyRows(2)
    const next = applyPaste(rows, 1, 'thrust', '0.5\t16.1\t2\textra\r\n0.6\t\t3\n')
    expect(next).toHaveLength(4)
    expect(next[0]).toEqual(EMPTY_ROW)
    expect(next[1]).toEqual({ pwm: '', thrust: '0.5', voltage: '16.1', current: '2' })
    expect(next[2]).toEqual({ pwm: '', thrust: '0.6', voltage: '', current: '3' })
    expect(next[3]).toEqual(EMPTY_ROW)
  })

  it('detects spreadsheet ranges', () => {
    expect(isRangePaste('1\t2')).toBe(true)
    expect(isRangePaste('1\n2')).toBe(true)
    expect(isRangePaste('1500\n')).toBe(false)
  })
})
