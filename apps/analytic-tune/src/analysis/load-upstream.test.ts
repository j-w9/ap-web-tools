// Oracle tests for upstream load_log's edge cases and the page state it carries from one log to
// the next (vehicle_type, aspeed/eas2tas), against the port on the same logs.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { LogWriter } from '@apwt/dataflash/testing'
import { identifyResponses, measuredResponses } from './freq-resp.js'
import { PartialTuneLogError, TuneLogError, loadTuneLog } from './load.js'
import { DEFAULT_INPUTS, INPUT_NAMES, tuneTarget, withInputs, type Inputs } from './params.js'
import { NotchSelectionError, predictResponses } from './predict.js'
import { SidRunError } from './sid.js'
import { INITIAL_AIRSPEED_SCALING, airspeedScalingFor, loadTimeHistory, type AirspeedScaling } from './time-history.js'
import { expectComplexBitEqual } from './test-utils/compare.js'
import { buildSidLog, toArrayBuffer, type SyntheticLogOptions } from './test-utils/synthetic.js'
import { loadAnalyticTuneUpstream, loadUpstreamParser, type UpstreamAnalyticTune } from './test-utils/upstream.js'

let Parser: unknown
beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  Parser = await loadUpstreamParser()
})

function upstream(): UpstreamAnalyticTune {
  const up = loadAnalyticTuneUpstream(Parser)
  up.setupPlots()
  return up
}

function expectSameInputs(inputs: Inputs, up: UpstreamAnalyticTune): void {
  for (const name of INPUT_NAMES) expect(inputs[name], name).toBe(parseFloat(up.getForm(name)))
}

const FIXED_WING: SyntheticLogOptions = {
  vehicle: 'fixed-wing',
  params: { RLL_RATE_P: 0.08, RLL_RATE_I: 0.1, RLL_RATE_FF: 0.3, RLL2SRV_TCONST: 0.4, SCHED_LOOP_RATE: 50 },
  runs: [{ axis: 20, start: 5, length: 20 }]
}

const COPTER: SyntheticLogOptions = {
  vehicle: 'copter',
  params: { ATC_RAT_RLL_P: 0.135, ATC_RAT_RLL_FF: 0.05, ATC_RAT_RLL_D_FF: 0.001, SCHED_LOOP_RATE: 400 },
  runs: [{ axis: 7, start: 5, length: 20 }]
}

describe('load_log edge cases', () => {
  it('a log without parameters: upstream alerts "No params in log"', () => {
    const w = new LogWriter()
    w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
    w.defineFormat(0x81, 'MSG', 'QZ', 'TimeUS,Message')
    w.write('MSG', [1, 'ArduCopter V4.6.0'])
    const bytes = w.toBytes()
    expect(() => upstream().loadLog(toArrayBuffer(bytes))).toThrow('upstream alert: No params in log')
    expect(() => loadTuneLog(bytes)).toThrow(new TuneLogError('No params in log'))
  })

  it('SIDD without SIDS: upstream throws before copying parameters', () => {
    const w = new LogWriter()
    w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
    w.defineFormat(0x81, 'PARM', 'QNfff', 'TimeUS,Name,Value,Default,Flags')
    w.defineFormat(0x84, 'SIDD', 'Qfffffffff', 'TimeUS,Time,Targ,F,Gx,Gy,Gz,Ax,Ay,Az')
    w.write('PARM', [1, 'ATC_RAT_RLL_P', 0.3, 0.3, 0])
    for (let k = 0; k < 10; k++) w.write('SIDD', [1000000 + k * 2500, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const bytes = w.toBytes()
    const up = upstream()
    expect(() => up.loadLog(toArrayBuffer(bytes))).toThrow(/Cannot read properties of (null|undefined)/)
    expect(up.getForm('ATC_RAT_RLL_P')).toBe('0.288')
    expect(() => loadTuneLog(bytes)).toThrow(TuneLogError)
  })

  it('more SIDS records than SIDD runs: upstream throws listing the runs, before copying parameters', () => {
    const bytes = buildSidLog({ ...COPTER, runs: [{ axis: 7, start: 5, length: 3 }] })
    // Append a second SIDS record with no data after it by re-logging a SIDS-only run.
    const w = new LogWriter()
    w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
    w.defineFormat(0x83, 'SIDS', 'QBfffffff', 'TimeUS,Ax,Mag,FSt,FSp,TFin,TC,TR,TFout')
    w.write('SIDS', [60000000, 8, 10, 0.5, 40, 0, 0, 5, 0])
    const extra = w.toBytes()
    const combined = new Uint8Array(bytes.length + extra.length)
    combined.set(bytes)
    combined.set(extra, bytes.length)
    const up = upstream()
    expect(() => up.loadLog(toArrayBuffer(combined))).toThrow(/Cannot read properties of (null|undefined)/)
    expect(up.getForm('ATC_RAT_RLL_P')).toBe('0.288')
    expect(() => loadTuneLog(combined)).toThrow(SidRunError)
  })

  it('no SID data: upstream still copies the parameters', () => {
    const bytes = buildSidLog({ ...COPTER, runs: [] })
    const up = upstream()
    up.loadLog(toArrayBuffer(bytes))
    const loaded = loadTuneLog(bytes)
    expect(loaded.runs).toEqual([])
    expect(loaded.flight).toBeNull()
    expectSameInputs(withInputs(DEFAULT_INPUTS, loaded.inputs), up)
  })

  it('a plane without SIDS: upstream throws after copying the harmonic notch parameters', () => {
    const bytes = buildSidLog({
      ...FIXED_WING,
      params: { ...FIXED_WING.params, INS_HNTCH_FREQ: 95, INS_HNTCH_MODE: 7, INS_HNTC2_ENABLE: 1 },
      runs: []
    })
    const up = upstream()
    expect(() => up.loadLog(toArrayBuffer(bytes))).toThrow(/Cannot read properties of (null|undefined)/)
    let partial: Inputs = DEFAULT_INPUTS
    try {
      loadTuneLog(bytes)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(PartialTuneLogError)
      if (e instanceof PartialTuneLogError) partial = withInputs(DEFAULT_INPUTS, e.inputs)
    }
    expectSameInputs(partial, up)
    // A mode that is not one of the drop-down's options leaves it empty.
    expect(partial.INS_HNTCH_MODE).toBeNaN()
  })
})

describe('page state carried between logs', () => {
  it('a log without a firmware banner keeps the previous vehicle', () => {
    const plane = buildSidLog(FIXED_WING)
    const unnamed = buildSidLog({ ...FIXED_WING, banner: null, params: { RLL_RATE_P: 0.2, ATC_RAT_RLL_P: 0.5 } })
    const up = upstream()
    up.loadLog(toArrayBuffer(plane))
    up.loadLog(toArrayBuffer(unnamed))
    const first = loadTuneLog(plane)
    const second = loadTuneLog(unnamed, { vehicle: first.vehicle })
    expect(up.state().vehicleType).toBe('ArduPlane_FW')
    expect(second.vehicle).toBe('fixed-wing')
    expectSameInputs(withInputs(withInputs(DEFAULT_INPUTS, first.inputs), second.inputs), up)
    // A fresh page starts as copter.
    expect(loadTuneLog(unnamed).vehicle).toBe('copter')
  })

  it('a multirotor analysed after a fixed-wing one uses the fixed-wing airspeed scaling', () => {
    const plane = buildSidLog(FIXED_WING)
    const copter = buildSidLog(COPTER)
    const up = upstream()
    up.loadLog(toArrayBuffer(plane))
    up.calculate()
    up.loadLog(toArrayBuffer(copter))
    up.calculate()
    const s = up.state()

    let airspeed: AirspeedScaling = INITIAL_AIRSPEED_SCALING
    let inputs: Inputs = DEFAULT_INPUTS
    for (const bytes of [plane, copter]) {
      const loaded = loadTuneLog(bytes)
      inputs = withInputs(inputs, loaded.inputs)
      const run = loaded.runs[0]!
      const target = tuneTarget(loaded.vehicle, 'Roll')!
      const history = loadTimeHistory(loaded.log, loaded.attitudeMessage, target, run.startTime, run.endTime)
      airspeed = airspeedScalingFor(history, airspeed)
      if (bytes !== copter) continue
      expect(airspeed).toEqual({ aspeed: s.aspeed, eas2tas: s.eas2tas })
      expect(airspeed.aspeed).not.toBe(1)
      const identified = identifyResponses(history, 'Roll', 1024)
      const measured = measuredResponses(identified, false, inputs.SCHED_LOOP_RATE)
      const predicted = predictResponses(measured.bareAircraft.H, identified.sampleRate, 1024, { target, inputs, airspeed })
      expectComplexBitEqual(predicted.rate, s.pred.ratectrl_H!, 'rate', true)
      expectComplexBitEqual(predicted.attitudeFeedforward, s.pred.attctrl_ff_H!, 'attitude ff', true)
    }
  })
})

describe('calculation failures', () => {
  const bytes = buildSidLog(COPTER)

  it.each([9, 1.5, 12])('a notch selection of %s names no FILTn group: both stop', (selection) => {
    const up = upstream()
    up.loadLog(toArrayBuffer(bytes))
    up.setForm('ATC_RAT_RLL_NEF', selection)
    expect(() => up.calculate()).toThrow(/Cannot read properties of (null|undefined)/)

    const loaded = loadTuneLog(bytes)
    const inputs = withInputs(withInputs(DEFAULT_INPUTS, loaded.inputs), new Map([['ATC_RAT_RLL_NEF', selection] as const]))
    const run = loaded.runs[0]!
    const target = tuneTarget(loaded.vehicle, 'Roll')!
    const history = loadTimeHistory(loaded.log, loaded.attitudeMessage, target, run.startTime, run.endTime)
    const identified = identifyResponses(history, 'Roll', 1024)
    const measured = measuredResponses(identified, false, inputs.SCHED_LOOP_RATE)
    expect(() =>
      predictResponses(measured.bareAircraft.H, identified.sampleRate, 1024, {
        target,
        inputs,
        airspeed: INITIAL_AIRSPEED_SCALING
      })
    ).toThrow(NotchSelectionError)
  })

  it('fixed-wing yaw: upstream has no fixed-wing yaw inputs and throws; the port has no target', () => {
    const plane = buildSidLog({ ...FIXED_WING, runs: [{ axis: 22, start: 5, length: 20 }] })
    const up = upstream()
    up.loadLog(toArrayBuffer(plane))
    expect(up.state().pageAxis).toBe('Yaw')
    expect(() => up.calculate()).toThrow(/Cannot read properties of null/)
    const loaded = loadTuneLog(plane)
    expect(loaded.vehicle).toBe('fixed-wing')
    expect(tuneTarget(loaded.vehicle, 'Yaw')).toBeNull()
  })

  it('negative and empty selections select nothing in both', () => {
    for (const selection of ['-1', '']) {
      const up = upstream()
      up.loadLog(toArrayBuffer(bytes))
      up.setForm('ATC_RAT_RLL_NTF', selection)
      expect(() => up.calculate()).not.toThrow()
    }
  })
})
