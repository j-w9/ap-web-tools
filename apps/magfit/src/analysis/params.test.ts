import { compassParamNames } from '@apwt/ardupilot'
import { describe, expect, it } from 'vitest'
import { buildParamFile, checkParams, readCompassParams, type CalParams } from './params.js'

const good: CalParams = {
  offsets: [10, -20, 30.5],
  diagonals: [1.01, 0.99, 1],
  offDiagonals: [0.01, -0.02, 0],
  scale: 1.02,
  motor: [0, 0, 0],
  orientation: 0,
  fitType: 0
}

describe('params', () => {
  it('reads missing parameters as NaN', () => {
    const p = readCompassParams(
      new Map([
        ['COMPASS_OFS_X', 5],
        ['COMPASS_ORIENT', 4]
      ]),
      compassParamNames(1)
    )
    expect(p.offsets[0]).toBe(5)
    expect(p.orientation).toBe(4)
    expect(p.scale).toBeNaN()
  })

  it('reports out of range values and orientation changes like upstream check_params', () => {
    const names = compassParamNames(2)
    expect(checkParams(1, names, good, { orientation: 0 })).toBe('')
    const bad: CalParams = { ...good, offsets: [2000, 0, -1600], diagonals: [1.3, 1, 1], scale: 0.7, orientation: 4 }
    expect(checkParams(1, names, bad, { orientation: 0 })).toBe(
      'MAG 2 params outside typical range:\n' +
        'COMPASS_OFS2_X 2000 larger than 1500\n' +
        'COMPASS_OFS2_Z -1600 less than -1500\n' +
        'COMPASS_DIA2_X 1.3 larger than 1.2\n' +
        'COMPASS_SCALE2 0.7 less than 0.8\n' +
        '\n' +
        'MAG 2 orientation (COMPASS_ORIENT2) changed from 0:None to 4:Yaw180\n'
    )
  })

  it('builds the parameter file in upstream order', () => {
    const result = buildParamFile([
      { compassIndex: 0, names: compassParamNames(1), params: good, fitName: 'Offsets and iron, No motor comp', use: 'dontUse' },
      { compassIndex: 2, names: compassParamNames(3), params: { ...good, motor: [1, 2, 3], fitType: 2 }, fitName: 'x' }
    ])
    expect(result).toEqual({
      ok: true,
      text: [
        'COMPASS_OFS_X,10',
        'COMPASS_OFS_Y,-20',
        'COMPASS_OFS_Z,30.5',
        'COMPASS_DIA_X,1.01',
        'COMPASS_DIA_Y,0.99',
        'COMPASS_DIA_Z,1',
        'COMPASS_ODI_X,0.01',
        'COMPASS_ODI_Y,-0.02',
        'COMPASS_ODI_Z,0',
        'COMPASS_MOT_X,0',
        'COMPASS_MOT_Y,0',
        'COMPASS_MOT_Z,0',
        'COMPASS_SCALE,1.02',
        'COMPASS_ORIENT,0',
        'COMPASS_USE,0',
        'COMPASS_OFS3_X,10',
        'COMPASS_OFS3_Y,-20',
        'COMPASS_OFS3_Z,30.5',
        'COMPASS_DIA3_X,1.01',
        'COMPASS_DIA3_Y,0.99',
        'COMPASS_DIA3_Z,1',
        'COMPASS_ODI3_X,0.01',
        'COMPASS_ODI3_Y,-0.02',
        'COMPASS_ODI3_Z,0',
        'COMPASS_MOT3_X,1',
        'COMPASS_MOT3_Y,2',
        'COMPASS_MOT3_Z,3',
        'COMPASS_SCALE3,1.02',
        'COMPASS_ORIENT3,0',
        'COMPASS_MOTCT,2',
        ''
      ].join('\n'),
      summary: 'Saved:\n\tCompass 1: Offsets and iron, No motor comp\n\tCompass 3: x\n'
    })
  })

  it('rejects mixed motor compensation types and empty selections', () => {
    const names = compassParamNames(1)
    const mixed = buildParamFile([
      { compassIndex: 0, names, params: { ...good, motor: [1, 0, 0], fitType: 2 }, fitName: 'a' },
      { compassIndex: 1, names: compassParamNames(2), params: { ...good, motor: [1, 0, 0], fitType: 1 }, fitName: 'b' }
    ])
    expect(mixed).toEqual({
      ok: false,
      error: 'All compasses must use the same motor fit type, current and throttle compensation cannot be used together'
    })
    expect(buildParamFile([])).toEqual({ ok: false, error: 'No parameters to save' })
  })
})
