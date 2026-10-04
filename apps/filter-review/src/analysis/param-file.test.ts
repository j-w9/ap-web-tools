import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { filterToolUrl } from './filter-tool-link.js'
import { bitmaskFromBits, defaultPageValues, filterParamsFromPage, sanitizeNumberInput, withPageValue } from './page-values.js'
import { applyParamFile, filterParamFileText, pageParams } from './param-file.js'

const upstreamDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../upstream')

/** INS_* parameter ids in the order upstream's save finds them: number inputs, then drop-downs. */
function upstreamPageOrder(): string[] {
  const html = readFileSync(resolve(upstreamDir, 'FilterReview/index.html'), 'utf8')
  const ids = [...html.matchAll(/<input id="(INS_[A-Z0-9_]+)"/g)].map((m) => m[1] ?? '')
  const metadata = JSON.parse(readFileSync(resolve(upstreamDir, 'FilterReview/params.json'), 'utf8')) as unknown
  // Same lookup as upstream load_param_inputs: descend into keys that prefix the name
  const find = (obj: unknown, name: string): Record<string, unknown> | undefined => {
    if (typeof obj !== 'object' || obj === null) return undefined
    for (const [key, value] of Object.entries(obj)) {
      if (!name.startsWith(key)) continue
      if (key === name) return value as Record<string, unknown>
      const found = find(value, name)
      if (found !== undefined) return found
    }
    return undefined
  }
  // Parameters with a Values list are replaced by a <select> (ENABLE and MODE)
  const isSelect = (id: string): boolean => find(metadata, id)?.['Values'] !== undefined
  return [...ids.filter((id) => !isSelect(id)), ...ids.filter(isSelect)]
}

describe('parameter file', () => {
  it('lists parameters in upstream page order', () => {
    expect(pageParams(defaultPageValues()).map((p) => p.name)).toEqual(upstreamPageOrder())
  })

  it('writes the page values through param_to_string', () => {
    let values = defaultPageValues()
    values = withPageValue(values, 'INS_GYRO_FILTER', 0.6499999761581421)
    values = withPageValue(values, 'INS_HNTCH_BW', 40.099998474121094)
    values = withPageValue(values, 'INS_HNTCH_HMNCS', -125)
    values = withPageValue(values, 'INS_HNTC2_MODE', 7)
    const lines = filterParamFileText(values).split('\n')
    expect(lines[0]).toBe('INS_GYRO_FILTER,0.65')
    expect(lines).toContain('INS_HNTCH_HMNCS,-125')
    expect(lines).toContain('INS_HNTCH_BW,40.1')
    // A mode the drop-down does not offer is kept as its number (proven upstream bug fixed, row 9;
    // upstream's drop-down reads empty and writes 0, proofs/filter-review/select-nan.test.ts)
    expect(lines.at(-2)).toBe('INS_HNTC2_MODE,7')
  })

  it('reads lines as upstream splits them', () => {
    const text =
      'INS_HNTCH_ENABLE 1\nINS_HNTCH_FREQ=95\nINS_HNTCH_HMNCS,-1\nSCHED_LOOP_RATE\t800\n# comment\nUNKNOWN,4\n  INS_GYRO_FILTER,40\r\nINS_HNTCH_BW,abc\n'
    expect(applyParamFile(text).assignments).toEqual([
      { kind: 'param', name: 'INS_HNTCH_ENABLE', value: '1' },
      { kind: 'param', name: 'INS_HNTCH_FREQ', value: '95' },
      { kind: 'param', name: 'INS_HNTCH_HMNCS', value: '-1' },
      { kind: 'param', name: 'SCHED_LOOP_RATE', value: '800' },
      { kind: 'param', name: 'INS_HNTCH_BW', value: '' }
    ])
  })

  it('reads inputs as parameter_get_value', () => {
    let values = withPageValue(defaultPageValues(), 'INS_HNTCH_HMNCS', -1)
    values = withPageValue(values, 'INS_HNTCH_FREQ', '')
    expect(filterParamsFromPage(values, false).notches[0].harmonics).toBe(255)
    expect(filterParamsFromPage(values, true).notches[0].harmonics).toBe(-1)
    expect(filterParamsFromPage(values, true).notches[0].freq).toBeNaN()
    expect(filterParamsFromPage(defaultPageValues(), true).gyroFilter).toBe(20)
  })

  it('sanitizes like a number input', () => {
    expect(['12', '-1.5', '.5', '1e3', '5.', '+5', ' 5', '1x', 'NaN', 'Infinity', '1e400', ''].map(sanitizeNumberInput)).toEqual([
      '12',
      '-1.5',
      '.5',
      '1e3',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ])
  })

  it('converts bitmask chips as read_bits', () => {
    expect(bitmaskFromBits([0, 1, 7], 8)).toBe(-125)
    expect(bitmaskFromBits([0, 1, 7], 32)).toBe(131)
  })

  it('builds the Filter Tool link', () => {
    const url = filterToolUrl('https://example.org/FilterTool/', defaultPageValues(), {
      gyroSampleRate: 1999.6,
      throttle: 0.3,
      rpm1: undefined,
      escRpm: 6000,
      numMotors: 4,
      rpm2: undefined
    })
    const query = new URL(url).searchParams
    expect(query.get('INS_GYRO_FILTER')).toBe('20.0')
    expect(query.get('GYRO_SAMPLE_RATE')).toBe('2000')
    expect(query.get('NUM_MOTORS')).toBe('4')
    expect(query.has('RPM1')).toBe(false)
    expect(query.has('SCHED_LOOP_RATE')).toBe(false)
  })
})
