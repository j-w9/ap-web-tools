// Unit tests of the upstream reading rules; page.test.ts compares the same functions with the
// upstream page.
import { describe, expect, it } from 'vitest'
import { assignFieldText } from './fields.js'
import { SAVED_PARAMS, formatParamFile, parseParamFile } from './param-file.js'
import { DEFAULT_INPUTS } from './params.js'

describe('parseParamFile', () => {
  it('reads comma, space, tab and = separated lines and skips unknown names', () => {
    const text = ['# comment', 'INS_HNTCH_ENABLE,1', 'INS_HNTCH_FREQ 82.5', 'INS_HNTCH_BW\t41', 'INS_GYRO_FILTER=40'].join('\n')
    expect(parseParamFile(text + '\nQ_A_RAT_RLL_P,0.2\nGPS_TYPE,1\n')).toEqual({
      INS_HNTCH_ENABLE: 1,
      INS_HNTCH_FREQ: 82.5,
      INS_HNTCH_BW: 41,
      INS_GYRO_FILTER: 40,
      ATC_RAT_RLL_P: 0.2
    })
  })

  it('ignores indented lines, as upstream does not trim', () => {
    expect(parseParamFile('  SCHED_LOOP_RATE,400\n')).toEqual({})
  })

  it('sets NaN for empty or invalid number text, as a number input does', () => {
    expect(parseParamFile('INS_HNTCH_BW,\nINS_HNTCH_ATT,Infinity\nINS_HNTCH_FREQ,5.\nINS_HNTCH_REF,0.5\r\n')).toEqual({
      INS_HNTCH_BW: NaN,
      INS_HNTCH_ATT: NaN,
      INS_HNTCH_FREQ: NaN,
      INS_HNTCH_REF: 0.5
    })
  })

  it('sets NaN for select values that are not an option', () => {
    expect(parseParamFile('INS_HNTCH_MODE 1.5\nINS_HNTC2_MODE,3\nINS_HNTCH_ENABLE,2\n')).toEqual({
      INS_HNTCH_MODE: NaN,
      INS_HNTC2_MODE: 3,
      INS_HNTCH_ENABLE: NaN
    })
    expect(assignFieldText('SCHED_LOOP_RATE', '333')).toBe(333)
  })

  it('proven upstream bug fixed: a number equal to an option selects it (upstream reads NaN)', () => {
    // docs/bug-proofs/filter-tool.md, row 2; upstream's NaN is pinned in proofs/filter-tool and in
    // page.test.ts "loaded file matches upstream load_parameters".
    expect(
      parseParamFile('INS_HNTCH_ENABLE 0.000000\nINS_HNTCH_MODE 1.000000\nINS_HNTC2_MODE,1e0\nINS_HNTC2_ENABLE,-0\n')
    ).toEqual({
      INS_HNTCH_ENABLE: 0,
      INS_HNTCH_MODE: 1,
      INS_HNTC2_MODE: 1,
      INS_HNTC2_ENABLE: 0
    })
    expect(assignFieldText('INS_HNTCH_MODE', '1abc')).toBeNaN()
  })
})

describe('formatParamFile', () => {
  it('writes the INS_ parameters in upstream form order, selects last', () => {
    const text = formatParamFile({ ...DEFAULT_INPUTS, INS_HNTCH_FREQ: 82.5, INS_HNTC2_BW: NaN, ATC_RAT_RLL_P: 0.3 })
    const lines = text.trim().split('\n')
    expect(lines).toHaveLength(19)
    expect(lines.slice(0, 3)).toEqual(['INS_GYRO_FILTER,20', 'INS_HNTCH_FREQ,82.5', 'INS_HNTCH_BW,0'])
    expect(lines).toContain('INS_HNTC2_BW,0')
    expect(SAVED_PARAMS.slice(-4)).toEqual(['INS_HNTCH_ENABLE', 'INS_HNTCH_MODE', 'INS_HNTC2_ENABLE', 'INS_HNTC2_MODE'])
  })
})
