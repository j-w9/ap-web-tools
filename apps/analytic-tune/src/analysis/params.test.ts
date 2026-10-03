import { describe, expect, it } from 'vitest'
import {
  ALL_TARGETS,
  DEFAULT_INPUTS,
  INPUT_NAMES,
  INPUT_STEPS,
  controllerParams,
  filterIndex,
  targetPrefixes,
  tuneTarget,
  withInputs
} from './params.js'
import { upstreamFormDefaults } from './test-utils/upstream.js'

describe('inputs', () => {
  const upstream = upstreamFormDefaults()
  const upstreamOrder = upstream.numbers.filter((id) => INPUT_NAMES.some((n) => n === id))

  it('lists every upstream input except the fixed-wing yaw notches, in form order', () => {
    expect(INPUT_NAMES).toEqual(upstreamOrder)
    const skipped = upstream.numbers.filter(
      (id) => !INPUT_NAMES.some((n) => n === id) && !['FFTWindow_size', 'starttime', 'endtime'].includes(id)
    )
    expect(skipped).toEqual(['YAW_RATE_NTF', 'YAW_RATE_NEF'])
  })

  it.each(INPUT_NAMES)('%s default and step match upstream index.html', (name) => {
    expect(DEFAULT_INPUTS[name]).toBe(parseFloat(upstream.values.get(name)!))
    expect(INPUT_STEPS[name]).toBe(parseFloat(upstream.steps.get(name)!))
  })

  it('applies values', () => {
    const next = withInputs(DEFAULT_INPUTS, new Map([['ATC_RAT_RLL_P', 0.5] as const]))
    expect(next.ATC_RAT_RLL_P).toBe(0.5)
    expect(DEFAULT_INPUTS.ATC_RAT_RLL_P).toBe(0.288)
    expect(withInputs(DEFAULT_INPUTS, new Map())).toBe(DEFAULT_INPUTS)
  })
})

describe('controller parameters', () => {
  it('names each target as upstream does', () => {
    expect(controllerParams({ vehicle: 'copter', axis: 'Roll' })).toMatchObject({
      rate: { P: 'ATC_RAT_RLL_P', D_FF: 'ATC_RAT_RLL_D_FF', NEF: 'ATC_RAT_RLL_NEF' },
      angle: { kind: 'gain', param: 'ATC_ANG_RLL_P' },
      inputTc: 'ATC_INPUT_TC'
    })
    expect(controllerParams({ vehicle: 'quadplane', axis: 'Yaw' })).toMatchObject({
      rate: { FLTT: 'Q_A_RAT_YAW_FLTT' },
      angle: { param: 'Q_A_ANG_YAW_P' },
      inputTc: 'Q_PLT_Y_RATE_TC'
    })
    expect(controllerParams({ vehicle: 'fixed-wing', axis: 'Pitch' })).toMatchObject({
      rate: { I: 'PTCH_RATE_I' },
      angle: { kind: 'time-constant', param: 'PTCH2SRV_TCONST' },
      inputTc: null
    })
  })

  it('every controller parameter is an input', () => {
    for (const target of ALL_TARGETS) {
      const p = controllerParams(target)
      for (const name of [...Object.values(p.rate), p.angle.param]) expect(INPUT_NAMES).toContain(name)
    }
  })

  it('builds upstream name prefixes', () => {
    expect(targetPrefixes({ vehicle: 'copter', axis: 'Pitch' })).toEqual({
      atc: 'ATC_',
      pilot: 'PILOT_',
      rate: 'ATC_RAT_PIT_',
      angle: 'ATC_ANG_PIT_'
    })
    expect(targetPrefixes({ vehicle: 'fixed-wing', axis: 'Roll' })).toEqual({
      atc: '',
      pilot: '',
      rate: 'RLL_RATE_',
      angle: 'RLL2SRV_'
    })
  })

  it('has no fixed-wing yaw target', () => {
    expect(tuneTarget('fixed-wing', 'Yaw')).toBeNull()
    expect(tuneTarget('quadplane', 'Yaw')).toEqual({ vehicle: 'quadplane', axis: 'Yaw' })
  })

  it('maps notch selections to filter indices', () => {
    expect(filterIndex(3)).toBe(3)
    expect(filterIndex(0)).toBeNull()
    expect(filterIndex(9)).toBeNull()
    expect(filterIndex(1.5)).toBeNull()
  })
})
