import { describe, expect, it } from 'vitest'
import { formatParamFile, paramToString, parseParamFile } from './param-file.js'
import { DEFAULT_INPUTS } from './params.js'
import { loadFilterToolUpstream } from './test-utils/upstream.js'

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
})

describe('paramToString', () => {
  it('matches upstream param_to_string', () => {
    const up = loadFilterToolUpstream()
    for (const v of [0, 1, 0.1, 0.135, 0.0036, 82.5, 1e-7, 123456789, -3.3, 2 / 3]) {
      expect(paramToString(v)).toBe(up.param_to_string(v))
    }
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
