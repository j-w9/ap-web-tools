import { describe, expect, it } from 'vitest'
import {
  changedParamsText,
  exportFileName,
  minimalParams,
  minimalParamsText,
  PARAM_GROUPS,
  presentGroupParams
} from './minimal-params.js'

const m = (o: Record<string, number>): Map<string, number> => new Map(Object.entries(o))

describe('parameter groups', () => {
  it('has the upstream checkbox groups', () => {
    expect(PARAM_GROUPS.map((g) => g.id)).toEqual([
      'ins_gyro',
      'ins_accel',
      'ins_use',
      'ins_position',
      'compass_calibration',
      'compass_ordering',
      'compass_id',
      'compass_use',
      'declination',
      'baro_calibration',
      'baro_id',
      'baro_wind_comp',
      'airspeed_type',
      'airspeed_calibration',
      'airspeed_use',
      'ahrs_trim',
      'ahrs_orientation',
      'rc_calibration',
      'rc_reverse',
      'rc_dz',
      'rc_options',
      'rc_flightmodes',
      'stream_0',
      'stream_1',
      'stream_2',
      'stream_3',
      'stream_4',
      'stream_5',
      'stream_6'
    ])
    const group = (id: string) => PARAM_GROUPS.find((g) => g.id === id)?.params ?? []
    expect(group('ins_gyro').slice(0, 5)).toEqual([
      'INS_GYROFFS_X',
      'INS_GYROFFS_Y',
      'INS_GYROFFS_Z',
      'INS_GYR_ID',
      'INS_GYR1_CALTEMP'
    ])
    expect(group('ins_gyro')).toContain('INS4_GYR_ID')
    expect(group('ins_accel')).toContain('INS_ACC2SCAL_Z')
    expect(group('compass_id')).toEqual([
      'COMPASS_DEV_ID',
      'COMPASS_EXTERNAL',
      'COMPASS_DEV_ID2',
      'COMPASS_EXTERN2',
      'COMPASS_DEV_ID3',
      'COMPASS_EXTERN3',
      'COMPASS_DEV_ID4',
      'COMPASS_DEV_ID5',
      'COMPASS_DEV_ID6',
      'COMPASS_DEV_ID7',
      'COMPASS_DEV_ID8'
    ])
    expect(group('airspeed_type')).toContain('ARSPD2_TUBE_ORDR')
    expect(group('stream_0')).toContain('SR0_EXTRA1')
    expect(group('stream_0')).toContain('MAV1_EXTRA1')
  })
})

describe('parameter export', () => {
  const params = m({
    INS_GYR_ID: 1,
    INS_GYROFFS_X: 0.01,
    FRAME_CLASS: 1,
    STAT_RUNTIME: 99,
    FORMAT_VERSION: 120,
    RC1_MIN: 1000,
    ATC_P: 0.135
  })
  const defaults = m({ FRAME_CLASS: 1, RC1_MIN: 1100, ATC_P: 0.135 })

  it('finds present params per group, optionally only changed ones', () => {
    const rc = PARAM_GROUPS.find((g) => g.id === 'rc_calibration')
    if (rc === undefined) throw new Error('missing group')
    expect(presentGroupParams(rc, params, defaults, false)).toEqual(['RC1_MIN'])
    expect(presentGroupParams(rc, params, m({ RC1_MIN: 1000 }), true)).toEqual([])
  })

  it('writes changed params', () => {
    expect(changedParamsText(params, defaults)).toBe(
      'FORMAT_VERSION,120\nINS_GYR_ID,1\nINS_GYROFFS_X,0.01\nRC1_MIN,1000\nSTAT_RUNTIME,99\n'
    )
  })

  it('builds the minimal set from the selected groups', () => {
    expect([...minimalParams(params, defaults, { changedOnly: false, includedGroups: new Set() }).keys()]).toEqual([
      'FRAME_CLASS',
      'ATC_P'
    ])
    expect([
      ...minimalParams(params, defaults, { changedOnly: true, includedGroups: new Set(['ins_gyro', 'rc_calibration']) }).keys()
    ]).toEqual(['INS_GYR_ID', 'INS_GYROFFS_X', 'RC1_MIN'])
    expect(minimalParamsText(params, defaults, { changedOnly: true, includedGroups: new Set() })).toBe('')
  })

  it('names export files like upstream', () => {
    expect(exportFileName('C:\\logs\\00000012.BIN', '_minimal.param')).toBe('00000012_minimal.param')
    expect(exportFileName('/a/b/my.setup.param', '.param')).toBe('my.setup.param')
    expect(exportFileName(undefined, '.param')).toBe('log.param')
    expect(exportFileName('noext', '_changed.param')).toBe('noext_changed.param')
  })
})
