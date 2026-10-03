import { describe, expect, it } from 'vitest'
import {
  COPTER_PARAM_DOCS,
  COPTER_PARAM_NAMES,
  PLANE_PARAM_DOCS,
  PLANE_PARAM_NAMES,
  copterParamFields,
  findParamDoc,
  parseParamDoc
} from './params.js'

describe('parameter documentation', () => {
  it('documents every parameter the tool shows', () => {
    for (const name of COPTER_PARAM_NAMES) expect(COPTER_PARAM_DOCS.get(name), name).toBeDefined()
    for (const name of PLANE_PARAM_NAMES) expect(PLANE_PARAM_DOCS.get(name), name).toBeDefined()
  })

  it('reads units, increment, range and named values', () => {
    const doc = COPTER_PARAM_DOCS.get('ATC_INPUT_TC')
    expect(doc?.units).toBe('s')
    expect(doc?.increment).toBe(0.01)
    expect(doc?.range).toEqual({ low: 0, high: 1 })
    expect(doc?.values.get(0.15)).toBe('Medium')
    expect(PLANE_PARAM_DOCS.get('RLL_ANGLE_P')?.units).toBeNull()
  })

  it('searches the prefix tree like upstream', () => {
    const tree = { A_: { A_B: { Description: 'b' }, A_BC: { Description: 'bc' } } }
    expect(findParamDoc(tree, 'A_BC')?.description).toBe('bc')
    expect(findParamDoc(tree, 'A_X')).toBeNull()
    expect(parseParamDoc('not metadata')).toBeNull()
  })
})

describe('copterParamFields', () => {
  it('uses the yaw rate time constant for yaw', () => {
    expect(copterParamFields('Y', 'rate').map((f) => f.name)).toEqual([
      'ATC_RATE_Y_MAX',
      'ATC_ACC_Y_MAX',
      'PILOT_Y_RATE_TC',
      'ATC_INPUT_TC'
    ])
  })

  it('disables what the mode does not use, as upstream update_mode', () => {
    const enabled = (mode: 'angle' | 'rate' | 'angle+rate') =>
      Object.fromEntries(copterParamFields('R', mode).map((f) => [f.name, f.enabled]))
    expect(enabled('angle')).toMatchObject({ ACRO_RP_RATE_TC: false, ATC_INPUT_TC: true })
    expect(enabled('rate')).toMatchObject({ ACRO_RP_RATE_TC: true, ATC_INPUT_TC: false })
    expect(enabled('angle+rate')).toMatchObject({ ACRO_RP_RATE_TC: false, ATC_INPUT_TC: true })
  })
})
