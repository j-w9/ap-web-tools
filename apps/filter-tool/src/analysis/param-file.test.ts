import { describe, expect, it } from 'vitest'
import { formatParamFile, parseParamFile } from './param-file.js'
import { DEFAULT_INPUTS } from './params.js'

describe('parseParamFile', () => {
  it('reads comma, space, tab and = separated lines and skips unknown names', () => {
    const text = [
      '# comment',
      'INS_HNTCH_ENABLE,1',
      'INS_HNTCH_FREQ 82.5',
      'INS_HNTCH_BW\t41',
      'INS_GYRO_FILTER=40',
      '  SCHED_LOOP_RATE,  400  ',
      'Q_A_RAT_RLL_P,0.2',
      'GPS_TYPE,1',
      'INS_HNTCH_ATT,abc',
      ''
    ].join('\n')
    const parsed = parseParamFile(text)
    expect(parsed.values).toEqual({
      INS_HNTCH_ENABLE: 1,
      INS_HNTCH_FREQ: 82.5,
      INS_HNTCH_BW: 41,
      INS_GYRO_FILTER: 40,
      SCHED_LOOP_RATE: 400,
      ATC_RAT_RLL_P: 0.2
    })
    expect(parsed.ignored).toBe(2)
  })

  it('reads Windows line endings', () => {
    expect(parseParamFile('INS_HNTCH_HMNCS,3\r\n').values).toEqual({ INS_HNTCH_HMNCS: 3 })
  })

  it('counts empty and non-finite values as ignored, but not lines without a value', () => {
    expect(parseParamFile('INS_HNTCH_BW,\nINS_HNTCH_ATT,Infinity\nINS_HNTCH_FREQ\n,5\n')).toEqual({ values: {}, ignored: 2 })
  })
})

describe('formatParamFile', () => {
  it('writes only INS_ parameters, naturally sorted, and round-trips', () => {
    const text = formatParamFile({ ...DEFAULT_INPUTS, INS_HNTCH_FREQ: 82.5, ATC_RAT_RLL_P: 0.3 })
    const lines = text.trim().split('\n')
    expect(lines).toHaveLength(19)
    expect(lines.every((l) => l.startsWith('INS_'))).toBe(true)
    expect(lines[0]).toBe('INS_GYRO_FILTER,20')
    expect(parseParamFile(text).values.INS_HNTCH_FREQ).toBe(82.5)
  })
})
