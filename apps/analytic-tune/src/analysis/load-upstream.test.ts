// Oracle tests for upstream load_log's edge cases and the page state it carries from one log to
// the next (vehicle_type, aspeed/eas2tas), against the port on the same logs.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { LogWriter } from '@apwt/dataflash/testing'
import { identifyResponses, measuredResponses } from './freq-resp.js'
import { PartialTuneLogError, TuneLogError, loadTuneLog } from './load.js'
import { DEFAULT_INPUTS, INPUT_NAMES, tuneTarget, withInputs, type Inputs } from './params.js'
import { NotchSelectionError, predictResponses } from './predict.js'
import { tuneAxisForSid } from './sid.js'
import { INITIAL_AIRSPEED_SCALING, airspeedScalingFor, loadTimeHistory } from './time-history.js'
import { expectComplexBitEqual } from './test-utils/compare.js'
import { buildSidLog, toArrayBuffer, type SyntheticLogOptions } from './test-utils/synthetic.js'
import { loadAnalyticTuneUpstream, loadUpstreamParser, type UpstreamAnalyticTune } from './test-utils/upstream.js'

let Parser: unknown
beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  Parser = await loadUpstreamParser()
})

// With the proven sample-rate bug fixed (bug-proofs/analytic-tune.md row 108; see pipeline.test.ts).
function upstream(): UpstreamAnalyticTune {
  const up = loadAnalyticTuneUpstream(Parser, { fixSampleRate: true })
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

  it('proven upstream bug fixed: more SIDS records than SIDD runs loads, where upstream throws before copying parameters', () => {
    // docs/bug-proofs/analytic-tune.md, row 114.
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
    // The port loads it as it loads the same log without the extra record, which upstream loads.
    const port = loadTuneLog(combined)
    const matching = loadTuneLog(bytes)
    expect(port.runs).toEqual(matching.runs)
    expect(port.vehicle).toBe(matching.vehicle)
    expect([...port.inputs]).toEqual([...matching.inputs])
    const ok = upstream()
    ok.loadLog(toArrayBuffer(bytes))
    expect(port.inputs.get('ATC_RAT_RLL_P')).toBe(Number(ok.getForm('ATC_RAT_RLL_P')))
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

describe('fixed-wing yaw notch selections (YAW_RATE_NTF/NEF)', () => {
  it('are read from a plane log as upstream reads them, and not from a copter log', () => {
    for (const options of [FIXED_WING, COPTER]) {
      const bytes = buildSidLog({ ...options, params: { ...options.params, YAW_RATE_NTF: 2, YAW_RATE_NEF: 3 } })
      const up = upstream()
      up.loadLog(toArrayBuffer(bytes))
      const loaded = loadTuneLog(bytes)
      expectSameInputs(withInputs(DEFAULT_INPUTS, loaded.inputs), up)
      const expected = options === FIXED_WING ? [2, 3] : [0, 0]
      expect([loaded.inputs.get('YAW_RATE_NTF') ?? 0, loaded.inputs.get('YAW_RATE_NEF') ?? 0]).toEqual(expected)
    }
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

  it('a multirotor analysed after a fixed-wing one: upstream uses the fixed-wing airspeed scaling, the port 1 (proven bug)', () => {
    // Proven upstream bug, fixed (bug-proofs/analytic-tune.md row 105).
    const plane = buildSidLog(FIXED_WING)
    const copter = buildSidLog(COPTER)
    const up = upstream()
    up.loadLog(toArrayBuffer(plane))
    up.calculate()
    const planeState = up.state()
    up.loadLog(toArrayBuffer(copter))
    up.calculate()
    const s = up.state()
    // Upstream: the copter prediction is scaled by the plane window's airspeed.
    expect(planeState.aspeed).not.toBe(1)
    expect({ aspeed: s.aspeed, eas2tas: s.eas2tas }).toEqual({ aspeed: planeState.aspeed, eas2tas: planeState.eas2tas })

    // An upstream page that loads the same two logs but never calculates the plane window.
    const fresh = upstream()
    fresh.loadLog(toArrayBuffer(plane))
    fresh.loadLog(toArrayBuffer(copter))
    fresh.calculate()
    const f = fresh.state()
    expect([f.aspeed, f.eas2tas]).toEqual([1, 1])

    let inputs: Inputs = DEFAULT_INPUTS
    for (const bytes of [plane, copter]) {
      const loaded = loadTuneLog(bytes)
      inputs = withInputs(inputs, loaded.inputs)
      const run = loaded.runs[0]!
      const target = tuneTarget(loaded.vehicle, 'Roll')!
      const history = loadTimeHistory(loaded.log, loaded.attitudeMessage, target, run.startTime, run.endTime)
      const airspeed = airspeedScalingFor(history)
      if (bytes !== copter) {
        expect(airspeed).toEqual({ aspeed: planeState.aspeed, eas2tas: planeState.eas2tas })
        continue
      }
      expect(airspeed).toEqual(INITIAL_AIRSPEED_SCALING)
      const identified = identifyResponses(history, 'Roll', 1024)
      const measured = measuredResponses(identified, false, inputs.SCHED_LOOP_RATE)
      const predicted = predictResponses(measured.bareAircraft.H, identified.sampleRate, 1024, { target, inputs, airspeed })
      // The port's prediction is upstream's with aspeed = eas2tas = 1 ...
      expectComplexBitEqual(predicted.rate, f.pred.ratectrl_H!, 'rate', true)
      expectComplexBitEqual(predicted.attitudeFeedforward, f.pred.attctrl_ff_H!, 'attitude ff', true)
      // ... and differs from upstream's carried-over prediction.
      expect(Array.from(predicted.rate.re)).not.toEqual(s.pred.ratectrl_H![0])
    }
  })
})

describe('calculation failures', () => {
  const bytes = buildSidLog(COPTER)

  const predictWithNef = (selection: number) => {
    const loaded = loadTuneLog(bytes)
    const inputs = withInputs(withInputs(DEFAULT_INPUTS, loaded.inputs), new Map([['ATC_RAT_RLL_NEF', selection] as const]))
    const run = loaded.runs[0]!
    const target = tuneTarget(loaded.vehicle, 'Roll')!
    const history = loadTimeHistory(loaded.log, loaded.attitudeMessage, target, run.startTime, run.endTime)
    const identified = identifyResponses(history, 'Roll', 1024)
    const measured = measuredResponses(identified, false, inputs.SCHED_LOOP_RATE)
    return () =>
      predictResponses(measured.bareAircraft.H, identified.sampleRate, 1024, {
        target,
        inputs,
        airspeed: INITIAL_AIRSPEED_SCALING
      })
  }

  it('a notch selection of 1.5 names no FILTn group: both stop', () => {
    const up = upstream()
    up.loadLog(toArrayBuffer(bytes))
    up.setForm('ATC_RAT_RLL_NEF', 1.5)
    expect(() => up.calculate()).toThrow(/Cannot read properties of (null|undefined)/)
    expect(predictWithNef(1.5)).toThrow(NotchSelectionError)
  })

  it.each([9, 12])('proven upstream bug fixed: a notch selection of %s is no notch where upstream stops', (selection) => {
    // docs/bug-proofs/analytic-tune.md, row 113: the firmware finds no filter for the index and
    // applies no notch, so the port predicts exactly what it predicts for 0.
    const up = upstream()
    up.loadLog(toArrayBuffer(bytes))
    up.setForm('ATC_RAT_RLL_NEF', selection)
    expect(() => up.calculate()).toThrow(/Cannot read properties of (null|undefined)/)
    expect(predictWithNef(selection)()).toEqual(predictWithNef(0)())
  })

  it('proven upstream bug fixed: SID axes 22 and 23 tune roll and pitch, where upstream tunes yaw and roll', () => {
    // docs/bug-proofs/analytic-tune.md, "SID axes 22 and 23": the firmware defines 22 as FW mixer
    // roll and 23 as FW mixer pitch.
    for (const [axis, upstreamAxis, portAxis] of [
      [22, 'Yaw', 'Roll'],
      [23, 'Roll', 'Pitch']
    ] as const) {
      const plane = buildSidLog({ ...FIXED_WING, runs: [{ axis, start: 5, length: 20 }] })
      const up = upstream()
      up.loadLog(toArrayBuffer(plane))
      expect(up.state().pageAxis).toBe(upstreamAxis)
      const loaded = loadTuneLog(plane)
      expect(tuneAxisForSid(loaded.runs[0]!.axis)).toBe(portAxis)
    }
  })

  it('fixed-wing yaw: upstream has no fixed-wing yaw inputs and throws; the port has no target', () => {
    const plane = buildSidLog({ ...FIXED_WING, runs: [{ axis: 25, start: 5, length: 20 }] })
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
