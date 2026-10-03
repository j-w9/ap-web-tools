import { describe, expect, it } from 'vitest'
import { loadParamText, saveParamText, savedParamNames, urlSettings } from './param-file.js'
import { ALL_TARGETS, DEFAULT_INPUTS, controllerParams, withInputs, type InputName, type TuneTarget } from './params.js'
import { loadAnalyticTuneUpstream } from './test-utils/upstream.js'

const UPSTREAM_VEHICLE = { copter: 'ArduCopter', quadplane: 'ArduPlane_VTOL', 'fixed-wing': 'ArduPlane_FW' } as const

describe('saveParamText matches upstream save_parameters', () => {
  const selections = [
    { ntf: 0, nef: 0 },
    { ntf: 2, nef: 0 },
    { ntf: 0, nef: 5 },
    { ntf: 3, nef: 3 },
    { ntf: 8, nef: 1 }
  ]
  const cases = ALL_TARGETS.flatMap((target) =>
    selections.map((s) => ({ ...s, target, label: `${target.vehicle} ${target.axis}` }))
  )

  it.each(cases)('$label, NTF $ntf, NEF $nef', ({ target, ntf, nef }) => {
    const up = loadAnalyticTuneUpstream()
    up.setVehicleType(UPSTREAM_VEHICLE[target.vehicle])
    up.setPageAxis(target.axis)
    const rate = controllerParams(target).rate
    const values = new Map<InputName, number>([
      [rate.NTF, ntf],
      [rate.NEF, nef],
      [rate.P, 0.1234567],
      ['FILT3_NOTCH_FREQ', 33.3],
      ['INS_HNTCH_MODE', 3]
    ])
    for (const [name, value] of values) up.setForm(name, value)
    const saved = up.saveParameters()
    expect(saved.name).toBe('filter.param')
    expect(saveParamText(withInputs(DEFAULT_INPUTS, values), target)).toBe(saved.text)
  })

  it('lists input shaping, controllers, selected notches and INS/SCHED parameters', () => {
    const target: TuneTarget = { vehicle: 'copter', axis: 'Yaw' }
    const names = savedParamNames(withInputs(DEFAULT_INPUTS, new Map([['ATC_RAT_YAW_NTF', 4] as const])), target)
    expect(names).toContain('PILOT_Y_RATE_TC')
    expect(names).not.toContain('ATC_INPUT_TC')
    expect(names).toContain('ATC_ANG_YAW_P')
    expect(names).toContain('FILT4_NOTCH_Q')
    expect(names).not.toContain('FILT1_NOTCH_Q')
    // Drop-downs come last, as upstream collects them after the number inputs.
    expect(names.slice(-4)).toEqual(['INS_HNTCH_ENABLE', 'INS_HNTCH_MODE', 'INS_HNTC2_ENABLE', 'INS_HNTC2_MODE'])
  })
})

describe('loadParamText', () => {
  it('applies modelled parameters and counts the rest', () => {
    const loaded = loadParamText('ATC_RAT_RLL_P,0.2\nRPM1 3000\n# comment\nFOO_BAR,1\nINS_HNTCH_FREQ=95.5\nATC_RAT_PIT_I\tbad\n')
    expect([...loaded.values]).toEqual([
      ['ATC_RAT_RLL_P', 0.2],
      ['RPM1', 3000],
      ['INS_HNTCH_FREQ', 95.5]
    ])
    expect(loaded.ignored).toBe(1)
  })
})

describe('urlSettings', () => {
  it('reads inputs and graph settings ignoring case', () => {
    const s = urlSettings(
      'https://x/AnalyticTune/?atc_rat_rll_p=0.3&GyroSampleRate=4000&Control_Loop=Att_DRB&PID_Scale=Linear&pid_phasescale=unwrap&pid_feq_scale=linear&pid_feq_unit=RPS&UseAttitude=true&nope=1&RPM1=abc'
    )
    expect([...s.inputs]).toEqual([
      ['GyroSampleRate', 4000],
      ['ATC_RAT_RLL_P', 0.3]
    ])
    expect(s.display).toEqual({
      loop: 'disturbance-rejection',
      gain: 'linear',
      phase: 'unwrapped',
      frequencyAxis: 'linear',
      frequencyUnit: 'rad/s',
      useAttitude: true
    })
  })

  it('is empty without a query', () => {
    expect(urlSettings('https://x/AnalyticTune/')).toEqual({ inputs: new Map(), display: {} })
  })
})
