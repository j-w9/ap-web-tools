// End-to-end oracle: the upstream page, driven through its own load_log / calculate_freq_resp /
// redraw_freq_resp in a vm with a stub DOM, against the port on the same synthetic logs.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CONTROL_LOOPS, frequencyIn, gainOf, loopComparison, phaseOf, type ControlLoop } from './display.js'
import { identifyResponses, measuredResponses, type FrequencyResponse } from './freq-resp.js'
import { loadTuneLog, type LoadedTuneLog } from './load.js'
import { DEFAULT_INPUTS, INPUT_NAMES, tuneTarget, withInputs, type Inputs, type TuneVehicle } from './params.js'
import { predictResponses } from './predict.js'
import { tuneAxisForSid } from './sid.js'
import { loadTimeHistory } from './time-history.js'
import { expectBitEqual, expectComplexBitEqual } from './test-utils/compare.js'
import { buildSidLog, toArrayBuffer, type SyntheticLogOptions } from './test-utils/synthetic.js'
import { loadAnalyticTuneUpstream, loadUpstreamParser, type Pair, type UpstreamAnalyticTune } from './test-utils/upstream.js'

let Parser: unknown
beforeAll(async () => {
  // The upstream parser logs every message type it decodes.
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  Parser = await loadUpstreamParser()
})

const UPSTREAM_VEHICLE: Readonly<Record<TuneVehicle, string>> = {
  copter: 'ArduCopter',
  quadplane: 'ArduPlane_VTOL',
  'fixed-wing': 'ArduPlane_FW'
}

const UPSTREAM_LOOP_RADIO: Readonly<Record<ControlLoop, string>> = {
  'bare-aircraft': 'type_Bare_AC',
  rate: 'type_Rate_Ctrlr',
  'attitude-feedforward': 'type_Att_Ctrlr',
  'attitude-no-feedforward': 'type_Att_Ctrlr_nff',
  'input-shaping': 'type_Pilot_Ctrlr',
  'disturbance-rejection': 'type_Att_DRB',
  'rate-stability': 'type_Rate_Stab',
  'attitude-stability': 'type_Att_Stab',
  'system-stability': 'type_Sys_Stab'
}

const COPTER_PARAMS = {
  ATC_RAT_RLL_P: 0.135,
  ATC_RAT_RLL_I: 0.135,
  ATC_RAT_RLL_D: 0.0036,
  ATC_RAT_RLL_FF: 0.01,
  ATC_RAT_RLL_D_FF: 0.0004,
  ATC_RAT_RLL_FLTT: 20,
  ATC_RAT_RLL_FLTE: 5,
  ATC_RAT_RLL_FLTD: 20,
  ATC_RAT_RLL_NEF: 1,
  ATC_RAT_RLL_NTF: 2,
  ATC_RAT_PIT_P: 0.2,
  ATC_RAT_PIT_NTF: 1,
  ATC_RAT_PIT_NEF: 1,
  ATC_RAT_YAW_P: 0.3,
  ATC_RAT_YAW_FLTE: 2.5,
  ATC_ANG_RLL_P: 6,
  ATC_ANG_PIT_P: 5,
  ATC_ANG_YAW_P: 4,
  ATC_INPUT_TC: 0.2,
  PILOT_Y_RATE_TC: 0.1,
  FILT1_TYPE: 1,
  FILT1_NOTCH_FREQ: 45,
  FILT1_NOTCH_Q: 3,
  FILT1_NOTCH_ATT: 20,
  FILT2_TYPE: 1,
  FILT2_NOTCH_FREQ: 30,
  FILT2_NOTCH_Q: 1.5,
  FILT2_NOTCH_ATT: 15,
  INS_GYRO_FILTER: 40,
  INS_GYRO_RATE: 1,
  INS_HNTCH_ENABLE: 1,
  INS_HNTCH_MODE: 1,
  INS_HNTCH_FREQ: 80,
  INS_HNTCH_BW: 40,
  INS_HNTCH_ATT: 40,
  INS_HNTCH_REF: 0.2,
  INS_HNTCH_HMNCS: 7,
  INS_HNTCH_OPTS: 1,
  INS_HNTC2_ENABLE: 1,
  INS_HNTC2_MODE: 3,
  INS_HNTC2_FREQ: 120,
  INS_HNTC2_BW: 30,
  INS_HNTC2_ATT: 30,
  INS_HNTC2_REF: 1,
  INS_HNTC2_HMNCS: 1,
  INS_HNTC2_OPTS: 18,
  INS_RAW_LOG_OPT: 0,
  SCHED_LOOP_RATE: 400,
  FSTRATE_ENABLE: 0
}

const QUADPLANE_PARAMS = {
  Q_A_RAT_RLL_P: 0.25,
  Q_A_RAT_RLL_I: 0.2,
  Q_A_RAT_RLL_D: 0.004,
  Q_A_RAT_PIT_P: 0.3,
  Q_A_RAT_YAW_P: 0.4,
  Q_A_RAT_YAW_FF: 0.02,
  Q_A_ANG_RLL_P: 4,
  Q_A_ANG_YAW_P: 3,
  Q_A_INPUT_TC: 0.3,
  Q_PLT_Y_RATE_TC: 0.4,
  INS_GYRO_RATE: 2,
  INS_GYRO_FILTER: 60,
  SCHED_LOOP_RATE: 300,
  FSTRATE_ENABLE: 1,
  FSTRATE_DIV: 4
}

const FIXED_WING_PARAMS = {
  RLL_RATE_P: 0.08,
  RLL_RATE_I: 0.1,
  RLL_RATE_D: 0.002,
  RLL_RATE_FF: 0.3,
  RLL_RATE_FLTT: 3,
  RLL_RATE_NEF: 3,
  PTCH_RATE_P: 0.1,
  PTCH_RATE_FF: 0.4,
  RLL2SRV_TCONST: 0.4,
  PTCH2SRV_TCONST: 0.6,
  FILT3_NOTCH_FREQ: 12,
  FILT3_NOTCH_Q: 2,
  FILT3_NOTCH_ATT: 10,
  SCHED_LOOP_RATE: 50
}

interface Scenario {
  readonly name: string
  readonly log: SyntheticLogOptions
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'copter',
    log: {
      vehicle: 'copter',
      params: COPTER_PARAMS,
      runs: [
        { axis: 7, start: 5, length: 22 },
        { axis: 1, start: 30, length: 20 },
        { axis: 5, start: 53, length: 18 },
        { axis: 12, start: 74, length: 18 },
        { axis: 13, start: 95, length: 15 }
      ]
    }
  },
  {
    name: 'quadplane with ANG',
    log: {
      vehicle: 'quadplane',
      params: QUADPLANE_PARAMS,
      ang: true,
      runs: [
        { axis: 9, start: 5, length: 20 },
        { axis: 4, start: 28, length: 20 }
      ]
    }
  },
  {
    name: 'fixed wing',
    log: {
      vehicle: 'fixed-wing',
      params: FIXED_WING_PARAMS,
      runs: [
        { axis: 20, start: 5, length: 20 },
        { axis: 24, start: 28, length: 20 }
      ]
    }
  }
]

/** Upstream run selection, as `update_time_range` does it. */
function selectUpstreamRun(up: UpstreamAnalyticTune, index: number): void {
  const sets = up.state().sidSets
  up.setForm('starttime', sets.tstart[index]!)
  up.setForm('endtime', sets.tend[index]!)
  up.setSidAxis(sets.axis[index]!)
}

function compareResponse(mine: FrequencyResponse, H: Pair, coherence: number[], label: string): void {
  expectComplexBitEqual(mine.H, H, `${label}.H`)
  expectBitEqual(mine.coherence, coherence, `${label}.coh`)
}

function compareTrace(mine: ArrayLike<number>, theirs: ArrayLike<number>, label: string): void {
  expectBitEqual(mine, theirs, label, true)
}

describe.each(SCENARIOS)('$name log matches upstream', ({ log: options }) => {
  const bytes = buildSidLog(options)
  let loaded: LoadedTuneLog
  let inputs: Inputs
  beforeAll(() => {
    loaded = loadTuneLog(bytes)
    inputs = withInputs(DEFAULT_INPUTS, loaded.inputs)
  })

  function freshUpstream(): UpstreamAnalyticTune {
    const up = loadAnalyticTuneUpstream(Parser)
    up.setupPlots()
    up.loadLog(toArrayBuffer(bytes))
    return up
  }

  it('finds the same runs, vehicle and parameters', () => {
    const up = freshUpstream()
    const s = up.state()
    expect(loaded.vehicle).toBe(options.vehicle)
    expect(s.vehicleType).toBe(UPSTREAM_VEHICLE[loaded.vehicle])
    expect(s.useAngMessage).toBe(loaded.attitudeMessage === 'ANG')
    expect(loaded.runs).toHaveLength(options.runs.length)
    loaded.runs.forEach((run, i) => {
      expect(run.axis).toBe(s.sidSets.axis[i])
      expect(run.startTime).toBe(s.sidSets.tstart[i])
      expect(run.endTime).toBe(s.sidSets.tend[i])
    })
    for (const name of INPUT_NAMES) expect(inputs[name], name).toBe(parseFloat(up.getForm(name)))
    expectBitEqual(loaded.flight.time, Array.from(s.flightData.data[0]!.x!), 'SIDD time')
    expect(s.flightData.layout.xaxis.range).toEqual([loaded.runs[0]!.startTime, loaded.runs[0]!.endTime])
  })

  const cases = options.runs.flatMap((_, run) =>
    [false, true].map((useAttitude) => ({ run, useAttitude, windowSize: run % 2 === 0 ? 1024 : 512 }))
  )

  it.each(cases)('run $run, attitude feedback $useAttitude, window $windowSize', ({ run, useAttitude, windowSize }) => {
    const up = freshUpstream()
    if (run > 0) selectUpstreamRun(up, run)
    up.setForm('FFTWindow_size', windowSize)
    up.setChecked('UseAttitude', useAttitude)
    up.calculate()
    const s = up.state()

    // Upstream keeps the previous axis for runs that excite no single axis; loading sets the first run's.
    const sidRun = loaded.runs[run]!
    const axis = tuneAxisForSid(sidRun.axis) ?? tuneAxisForSid(loaded.runs[0]!.axis) ?? 'Roll'
    expect(s.pageAxis).toBe(axis)
    const target = tuneTarget(loaded.vehicle, axis)
    if (target === null) throw new Error('unsupported target')

    const history = loadTimeHistory(loaded.log, loaded.attitudeMessage, target, sidRun.startTime, sidRun.endTime)
    const identified = identifyResponses(history, target.axis, windowSize)
    expect(identified.sampleRate).toBe(s.dataSet.FFT.average_sample_rate)
    expect(identified.windowCount).toBe(s.dataSet.FFT.center.length)
    expect(history.airspeed).toEqual({ aspeed: s.aspeed, eas2tas: s.eas2tas })

    const measured = measuredResponses(identified, useAttitude, inputs.SCHED_LOOP_RATE)
    const c = s.calc
    expectBitEqual(measured.freq, c.freq as number[], 'freq')
    compareResponse(measured.pilot, c.pilotctrl_H as Pair, c.pilotctrl_coh as number[], 'pilot')
    compareResponse(measured.attitude, c.attctrl_H as Pair, c.attctrl_coh as number[], 'attitude')
    compareResponse(measured.rate, c.ratectrl_H as Pair, c.ratectrl_coh as number[], 'rate')
    compareResponse(measured.bareAircraft, c.bareAC_H as Pair, c.bareAC_coh as number[], 'bare aircraft')
    compareResponse(measured.disturbance, c.DRB_H as Pair, c.DRB_coh as number[], 'disturbance')
    compareResponse(measured.systemBrokenLoop, c.sysbl_H as Pair, c.sysbl_coh as number[], 'system')

    const predicted = predictResponses(measured.bareAircraft.H, identified.sampleRate, windowSize, {
      target,
      inputs,
      airspeed: history.airspeed
    })
    const p = s.pred
    expectComplexBitEqual(predicted.rate, p.ratectrl_H!, 'pred rate', true)
    expectComplexBitEqual(predicted.attitudeFeedforward, p.attctrl_ff_H!, 'pred att ff', true)
    expectComplexBitEqual(predicted.pilot, p.pilotctrl_H!, 'pred pilot', true)
    expectComplexBitEqual(predicted.attitudeNoFeedforward, p.attctrl_nff_H!, 'pred att nff', true)
    expectComplexBitEqual(predicted.disturbance, p.DRB_H!, 'pred drb', true)
    expectComplexBitEqual(predicted.attitudeBrokenLoop, p.attbl_H!, 'pred att bl', true)
    expectComplexBitEqual(predicted.rateBrokenLoop, p.ratebl_H!, 'pred rate bl', true)
    expectComplexBitEqual(predicted.systemBrokenLoop, p.sysbl_H!, 'pred sys bl', true)

    // Every plotted trace, for each loop and scale.
    const scales = [
      { gain: 'dB', unit: 'Hz' },
      { gain: 'linear', unit: 'rad/s' }
    ] as const
    for (const scale of scales) {
      up.setChecked('PID_ScaleLog', scale.gain === 'dB')
      up.setChecked('PID_ScaleLinear', scale.gain === 'linear')
      up.setChecked('PID_freq_Scale_Hz', scale.unit === 'Hz')
      up.setChecked('PID_freq_Scale_RPS', scale.unit === 'rad/s')
      for (const loop of CONTROL_LOOPS) {
        for (const l of CONTROL_LOOPS) up.setChecked(UPSTREAM_LOOP_RADIO[l], l === loop)
        up.redraw()
        const after = up.state()
        const cmp = loopComparison(loop, sidRun.axis, measured, predicted)
        const x = frequencyIn(measured.freq, scale.unit)
        const label = `${loop} ${scale.gain}`
        const [magCalc, magPred] = after.fftPlot.data
        const [phCalc, phPred] = after.fftPlotPhase.data
        const [cohCalc, cohPred] = after.fftPlotCoh.data
        compareTrace(x, magCalc!.x, `${label} x`)
        compareTrace(gainOf(cmp.calculated.H, scale.gain), magCalc!.y, `${label} calc gain`)
        compareTrace(phaseOf(cmp.calculated.H, 'wrapped'), phCalc!.y, `${label} calc phase`)
        compareTrace(cmp.calculated.coherence, cohCalc!.y, `${label} calc coh`)
        expect(cmp.calculated.visible, `${label} calc visible`).toBe(magCalc!.visible)
        compareTrace(gainOf(cmp.predicted.H, scale.gain), magPred!.y, `${label} pred gain`)
        compareTrace(phaseOf(cmp.predicted.H, 'wrapped'), phPred!.y, `${label} pred phase`)
        if (cmp.predicted.visible) compareTrace(cmp.predicted.coherence, cohPred!.y, `${label} pred coh`)
        expect(cmp.predicted.visible, `${label} pred visible`).toBe(magPred!.visible)
      }
    }
  })
})
