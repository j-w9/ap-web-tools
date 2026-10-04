import { describe, expect, it } from 'vitest'
import { loadParamText, saveParamText, savedParamNames, urlSettings } from './param-file.js'
import {
  ALL_TARGETS,
  DEFAULT_INPUTS,
  INPUT_NAMES,
  controllerParams,
  withInputs,
  type InputName,
  type TuneTarget
} from './params.js'
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

  it.each(selections)(
    'proven upstream bug fixed: fixed-wing yaw, NTF $ntf, NEF $nef, saves the file upstream throws on',
    ({ ntf, nef }) => {
      // docs/bug-proofs/analytic-tune.md, row 112.
      const values = new Map<InputName, number>([
        ['YAW_RATE_NTF', ntf],
        ['YAW_RATE_NEF', nef],
        ['FILT3_NOTCH_FREQ', 33.3],
        ['INS_HNTCH_MODE', 3]
      ])
      const page = (fixFixedWingYawSave: boolean) => {
        const up = loadAnalyticTuneUpstream(undefined, { fixFixedWingYawSave })
        up.setVehicleType('ArduPlane_FW')
        up.setPageAxis('Yaw')
        for (const [name, value] of values) up.setForm(name, value)
        return up
      }
      // The original's empty pilot prefix matches every element. On the real page that includes the
      // bitmask check boxes and the save throws "Could not convert on to float string"
      // (proofs/analytic-tune/logs.test.ts); this stub page has no check boxes, so it saves every input.
      const original = page(false).saveParameters().text.split('\n')
      expect(original).toContain('ATC_RAT_RLL_P,0.288')
      const fixed = page(true).saveParameters()
      expect(fixed.name).toBe('filter.param')
      const text = saveParamText(withInputs(DEFAULT_INPUTS, values), null)
      expect(text).toBe(fixed.text)
      expect(text.split('\n')).toContain(`YAW_RATE_NTF,${ntf}`)
      expect(text.split('\n')).toContain(`YAW_RATE_NEF,${nef}`)
      expect(text).not.toContain('ATC_RAT_RLL_P')
    }
  )

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

describe('loadParamText matches upstream load_parameters', () => {
  const files = [
    'ATC_RAT_RLL_P,0.2\nRPM1 3000\n# comment\nFOO_BAR,1\nINS_HNTCH_FREQ=95.5\nATC_RAT_PIT_I\tbad\n',
    // Indented lines set nothing; CRLF endings are fine; the second field is taken as written.
    '  ATC_RAT_RLL_P,0.5\r\nATC_RAT_RLL_I,0.25\r\nATC_RAT_RLL_D , 0.004\nATC_RAT_RLL_FF,,0.3\n',
    // Drop-downs empty themselves for a value equal to no option.
    'INS_HNTCH_ENABLE,1\nINS_HNTCH_MODE,7\nINS_HNTC2_ENABLE,2\nINS_HNTC2_MODE,1.5\n',
    // Number inputs keep only valid floating-point text.
    'ATC_RAT_RLL_P,.5\nATC_RAT_RLL_I,5.\nATC_RAT_RLL_D,+1\nATC_RAT_RLL_FF,1e-3\nATC_RAT_RLL_FLTT,0x10\nATC_RAT_RLL_FLTE,-0\nATC_RAT_RLL_FLTD,Infinity\n',
    'GyroSampleRate=4000\nThrottle,0.45\nNUM_MOTORS 4\nESC_RPM,3000\nFILT2_NOTCH_FREQ,80\nSCHED_LOOP_RATE,800\n',
    // Page elements that are not parameters.
    'FFTWindow_size,512\nstarttime,12.5\nendtime,abc\nUseAttitude,1\n',
    'FFTWindow_size,300\nendtime,40\ntype_Rate_Ctrlr,2\n',
    'FFTWindow_size,x\nUseAttitude,3\ncalculate,0\nPID_ScaleLog,1\nYAW_RATE_NEF,2\n',
    // A file input accepts an empty value.
    'param_file,\nATC_RAT_RLL_I,0.9\n'
  ]

  it.each(files.map((text, i) => ({ text, i })))('file $i', async ({ text }) => {
    const up = loadAnalyticTuneUpstream()
    up.setChecked('UseAttitude', false)
    let upstreamError: unknown
    try {
      await up.loadParameters(text)
    } catch (e) {
      upstreamError = e
    }
    expect(upstreamError, 'stopped').toBeUndefined()
    const loaded = loadParamText(text)

    const inputs = withInputs(DEFAULT_INPUTS, loaded.values)
    for (const name of INPUT_NAMES) expect(inputs[name], name).toBe(parseFloat(up.getForm(name)))
    expect(loaded.windowSizeText ?? '1024', 'window').toBe(up.getForm('FFTWindow_size'))
    // Upstream multiplies the trimmed time text by 1e6.
    expect(loaded.startTime ?? 0, 'start').toBe(Number(up.getForm('starttime').trim()))
    expect(loaded.endTime ?? 0, 'end').toBe(Number(up.getForm('endtime').trim()))
    expect(loaded.useAttitude ?? false, 'attitude').toBe(up.state().useAttitudeChecked)
  })

  it('MAVProxy-style drop-down values equal to an option: upstream reads NaN, the port the option (proven bug)', async () => {
    // Proven upstream bug, fixed (bug-proofs/analytic-tune.md row 107).
    const text = 'INS_HNTCH_ENABLE 0.000000\nINS_HNTCH_MODE 1.000000\nINS_HNTC2_ENABLE 1\nINS_HNTC2_MODE 3\n'
    const up = loadAnalyticTuneUpstream()
    await up.loadParameters(text)
    const inputs = withInputs(DEFAULT_INPUTS, loadParamText(text).values)
    expect(up.getForm('INS_HNTCH_ENABLE')).toBe('')
    expect(up.getForm('INS_HNTCH_MODE')).toBe('')
    expect(inputs.INS_HNTCH_ENABLE).toBe(0)
    expect(inputs.INS_HNTCH_MODE).toBe(1)
    const fixed: readonly InputName[] = ['INS_HNTCH_ENABLE', 'INS_HNTCH_MODE']
    for (const name of INPUT_NAMES) if (!fixed.includes(name)) expect(inputs[name], name).toBe(parseFloat(up.getForm(name)))
    // The same values written as option text read the same in both.
    const plain = loadAnalyticTuneUpstream()
    await plain.loadParameters('INS_HNTCH_ENABLE 0\nINS_HNTCH_MODE 1\n')
    expect([inputs.INS_HNTCH_ENABLE, inputs.INS_HNTCH_MODE]).toEqual([
      parseFloat(plain.getForm('INS_HNTCH_ENABLE')),
      parseFloat(plain.getForm('INS_HNTCH_MODE'))
    ])
  })

  it('a line naming the log file input: upstream stops there, the port skips it (proven bug)', async () => {
    // Proven upstream bug, fixed (bug-proofs/analytic-tune.md row 117).
    const text = 'ATC_RAT_RLL_P,0.7\nfileItem,x\nATC_RAT_RLL_I,0.9\n'
    const up = loadAnalyticTuneUpstream()
    await expect(up.loadParameters(text)).rejects.toThrow()
    const loaded = loadParamText(text)
    const inputs = withInputs(DEFAULT_INPUTS, loaded.values)
    expect(parseFloat(up.getForm('ATC_RAT_RLL_I'))).toBe(DEFAULT_INPUTS.ATC_RAT_RLL_I)
    expect(inputs.ATC_RAT_RLL_I).toBe(0.9)
    expect(loaded.ignored).toBe(1)
    for (const name of INPUT_NAMES) if (name !== 'ATC_RAT_RLL_I') expect(inputs[name], name).toBe(parseFloat(up.getForm(name)))
    // Without the file input line, upstream applies the rest exactly as the port does.
    const clean = loadAnalyticTuneUpstream()
    await clean.loadParameters('ATC_RAT_RLL_P,0.7\nATC_RAT_RLL_I,0.9\n')
    for (const name of INPUT_NAMES) expect(inputs[name], name).toBe(parseFloat(clean.getForm(name)))
  })

  it('counts lines naming nothing on the page', () => {
    expect(loadParamText('FOO,1\nATC_RAT_RLL_P,1\n  BAR,2\nUseAttitude,1\n').ignored).toBe(2)
  })
})

describe('saveParamText of empty inputs', () => {
  it('saves an empty input as 0, as upstream', () => {
    const up = loadAnalyticTuneUpstream()
    up.setForm('ATC_RAT_RLL_P', '')
    up.setForm('INS_HNTCH_MODE', '')
    const target: TuneTarget = { vehicle: 'copter', axis: 'Roll' }
    const values = new Map<InputName, number>([
      ['ATC_RAT_RLL_P', NaN],
      ['INS_HNTCH_MODE', NaN]
    ])
    expect(saveParamText(withInputs(DEFAULT_INPUTS, values), target)).toBe(up.saveParameters().text)
  })
})

describe('fixed-wing yaw save', () => {
  it('saves the file of proofs/analytic-tune/logs.test.ts for the page defaults (row 112)', () => {
    expect(saveParamText(DEFAULT_INPUTS, null).trimEnd().split('\n')).toEqual([
      'INS_GYRO_FILTER,20',
      'INS_HNTCH_FREQ,150',
      'INS_HNTCH_BW,75',
      'INS_HNTCH_ATT,40',
      'INS_HNTCH_REF,0.29',
      'INS_HNTCH_FM_RAT,0',
      'INS_HNTCH_HMNCS,3',
      'INS_HNTCH_OPTS,0',
      'INS_HNTC2_FREQ,0',
      'INS_HNTC2_BW,0',
      'INS_HNTC2_ATT,0',
      'INS_HNTC2_REF,0',
      'INS_HNTC2_FM_RAT,0',
      'INS_HNTC2_HMNCS,0',
      'INS_HNTC2_OPTS,0',
      'SCHED_LOOP_RATE,400',
      'YAW_RATE_NTF,0',
      'YAW_RATE_NEF,0',
      'INS_HNTCH_ENABLE,1',
      'INS_HNTCH_MODE,1',
      'INS_HNTC2_ENABLE,0',
      'INS_HNTC2_MODE,0'
    ])
  })

  it('reads YAW_RATE_NTF/NEF from a .param file and a link, as upstream', async () => {
    const text = 'YAW_RATE_NTF,4\nYAW_RATE_NEF,6\n'
    const up = loadAnalyticTuneUpstream()
    await up.loadParameters(text)
    const loaded = loadParamText(text)
    expect(loaded.ignored).toBe(0)
    const inputs = withInputs(DEFAULT_INPUTS, loaded.values)
    for (const name of INPUT_NAMES) expect(inputs[name], name).toBe(parseFloat(up.getForm(name)))
    expect([...urlSettings('https://x/AnalyticTune/?yaw_rate_ntf=4&YAW_RATE_NEF=6').inputs]).toEqual([
      ['YAW_RATE_NTF', 4],
      ['YAW_RATE_NEF', 6]
    ])
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

  it('keeps a drop-down value only if it is one of its options', () => {
    const s = urlSettings('https://x/?ins_hntch_mode=7&ins_hntc2_mode=3&ins_hntch_enable=1.5')
    expect(s.inputs.get('INS_HNTCH_MODE')).toBeNaN()
    expect(s.inputs.get('INS_HNTC2_MODE')).toBe(3)
    expect(s.inputs.get('INS_HNTCH_ENABLE')).toBeNaN()
  })

  it('is empty without a query', () => {
    expect(urlSettings('https://x/AnalyticTune/')).toEqual({ inputs: new Map(), display: {} })
  })
})
