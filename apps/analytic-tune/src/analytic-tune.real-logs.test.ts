/**
 * Real-log oracle, run only when `APWT_REAL_LOGS` names a directory of DataFlash `.bin` logs (the
 * logs are never part of the repository). For every log, the upstream AnalyticTune page (in node:vm
 * with the upstream JsDataflashParser, driven through its own `load_log`, `calculate_freq_resp`,
 * `calculate_predicted_TF` and `save_parameters`) and the port read the same bytes, and every
 * output is compared as `pipeline.test.ts`, `load-upstream.test.ts` and `param-file.test.ts`
 * compare it:
 *
 * - the runs, vehicle, attitude message and every page input `load_log` fills in;
 * - Calculate: a log without SIDD data has no time histories, and both stop;
 * - the predicted responses from the log's own controller and filter parameters, for each axis, on
 *   an aircraft response chosen by the test (the log has no measured one) at the log's RATE rate;
 * - the saved parameter file for each axis.
 *
 * The prediction is compared with the page that has the proven chained harmonic-notch spread fix
 * applied (docs/bug-proofs/filters.md row 2), as `filters.test.ts` does; the original page is also
 * run and must give the same result unless that case applies.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { frequencyGrid } from '@apwt/filters'
import { complexArrayOf, type ComplexArray } from '@apwt/signal'
import { TuneLogError, loadTuneLog, type LoadedTuneLog } from './analysis/load.js'
import { saveParamText } from './analysis/param-file.js'
import {
  DEFAULT_INPUTS,
  INPUT_NAMES,
  TUNE_AXES,
  tuneTarget,
  withInputs,
  type Inputs,
  type TuneVehicle
} from './analysis/params.js'
import { NotchSelectionError, predictResponses, type PredictedResponses } from './analysis/predict.js'
import { INITIAL_AIRSPEED_SCALING, loadTimeHistory } from './analysis/time-history.js'
import { expectComplexBitEqual } from './analysis/test-utils/compare.js'
import {
  loadAnalyticTuneUpstream,
  loadUpstreamParser,
  type LoadOptions,
  type Pair,
  type UpstreamAnalyticTune
} from './analysis/test-utils/upstream.js'

const dir = process.env['APWT_REAL_LOGS']
const files = dir
  ? readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.bin'))
      .sort()
  : []
const TIMEOUT = 900_000

const UPSTREAM_VEHICLE: Readonly<Record<TuneVehicle, string>> = {
  copter: 'ArduCopter',
  quadplane: 'ArduPlane_VTOL',
  'fixed-wing': 'ArduPlane_FW'
}

/** Upstream `calculate_predicted_TF`'s results, in its return order, against the port's. */
const PREDICTED_ORDER: readonly (keyof PredictedResponses)[] = [
  'rate',
  'attitudeFeedforward',
  'pilot',
  'disturbance',
  'attitudeNoFeedforward',
  'attitudeBrokenLoop',
  'rateBrokenLoop',
  'systemBrokenLoop'
]

const toArrayBuffer = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

/** A bare-aircraft response for the prediction: a first-order lag with a delay, on the model grid. */
function aircraftResponse(freq: Float64Array): ComplexArray {
  const h = complexArrayOf(freq.length)
  for (let k = 0; k < freq.length; k++) {
    const f = freq[k]!
    const w = 2 * Math.PI * f
    // 12 / (1 + j w / 30) * exp(-j w 0.004)
    const den = 1 + (w / 30) ** 2
    const lagRe = 12 / den
    const lagIm = (-12 * (w / 30)) / den
    const c = Math.cos(w * 0.004)
    const s = -Math.sin(w * 0.004)
    h.re[k] = lagRe * c - lagIm * s
    h.im[k] = lagRe * s + lagIm * c
  }
  return h
}

describe.skipIf(!dir)('Analytic Tune on real logs (APWT_REAL_LOGS)', () => {
  let Parser: unknown
  beforeAll(async () => {
    // The upstream parser logs every message type it decodes.
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    Parser = await loadUpstreamParser()
  })

  describe.each(files.length > 0 ? files : ['(no logs)'])('%s', (file) => {
    let bytes: Uint8Array
    let loaded: LoadedTuneLog
    let inputs: Inputs

    beforeAll(() => {
      const raw = readFileSync(join(dir!, file))
      bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
      loaded = loadTuneLog(bytes)
      inputs = withInputs(DEFAULT_INPUTS, loaded.inputs)
    }, TIMEOUT)

    function freshUpstream(options: LoadOptions = {}): UpstreamAnalyticTune {
      const up = loadAnalyticTuneUpstream(Parser, options)
      up.setupPlots()
      up.loadLog(toArrayBuffer(bytes))
      return up
    }

    it(
      'load_log: runs, vehicle, attitude message and every page input',
      () => {
        const up = freshUpstream()
        const s = up.state()
        expect(s.vehicleType).toBe(UPSTREAM_VEHICLE[loaded.vehicle])
        expect(s.useAngMessage).toBe(loaded.attitudeMessage === 'ANG')
        // These logs have no system identification data: upstream lists no runs and leaves the
        // analysis window and the flight data plot as they were.
        expect(loaded.messageTypes).not.toContain('SIDD')
        expect(loaded.runs).toEqual([])
        expect(loaded.flight).toBeNull()
        expect(s.sidSets.tstart).toBeUndefined()
        expect(s.flightData.data[0]!.x).toBeUndefined()
        expect([up.getForm('starttime'), up.getForm('endtime')]).toEqual(['0', '0'])
        for (const name of INPUT_NAMES) expect(inputs[name], name).toBe(parseFloat(up.getForm(name)))
      },
      TIMEOUT
    )

    it.each(TUNE_AXES)(
      'Calculate on %s: without SIDD there are no time histories, and both stop',
      (axis) => {
        const up = freshUpstream({ fixSampleRate: true })
        up.setPageAxis(axis)
        expect(() => up.calculate()).toThrow(/Cannot read properties of (null|undefined)/)
        const target = tuneTarget(loaded.vehicle, axis)
        if (target === null) throw new Error('no target')
        expect(() => loadTimeHistory(loaded.log, loaded.attitudeMessage, target, 0, 0)).toThrow(TuneLogError)
      },
      TIMEOUT
    )

    it.each(TUNE_AXES)(
      'predicted responses from the log parameters on %s',
      (axis) => {
        const target = tuneTarget(loaded.vehicle, axis)
        if (target === null) throw new Error('no target')
        // The rate the analysis would use: RATE's, (n - 1) / span (proven fix, row 108), and 400 Hz.
        const time = loaded.log.getNumbers('RATE', 'TimeUS')!
        const rateHz = (time.length - 1) / ((time[time.length - 1]! - time[0]!) / 1000000)
        const grids = [
          { rate: rateHz, window: 1024 },
          { rate: 400, window: 512 }
        ]
        const up = freshUpstream({ fixChainedSpread: true })
        const original = freshUpstream()
        for (const p of [up, original]) p.setPageAxis(axis)
        for (const g of grids) {
          const label = `${axis} @${g.rate}/${g.window}`
          const freq = frequencyGrid(g.rate * 0.5, g.rate / g.window)
          const h = aircraftResponse(freq)
          const pair: Pair = [Array.from(h.re), Array.from(h.im)]
          let mine: PredictedResponses
          try {
            mine = predictResponses(h, g.rate, g.window, { target, inputs, airspeed: INITIAL_AIRSPEED_SCALING })
          } catch (e) {
            // A notch selection naming no filter group stops both (load-upstream.test.ts).
            expect(e, label).toBeInstanceOf(NotchSelectionError)
            expect(() => up.calculate_predicted_TF(pair, g.rate, g.window), label).toThrow()
            continue
          }
          const theirs = up.calculate_predicted_TF(pair, g.rate, g.window)
          PREDICTED_ORDER.forEach((key, i) => expectComplexBitEqual(mine[key], theirs[i]!, `${label} ${key}`, true))
          // The original page differs only for chained copies (ESC mode, multi-source option, more
          // than one motor) of a clamped harmonic notch.
          const unpatched = original.calculate_predicted_TF(pair, g.rate, g.window)
          if (JSON.stringify(unpatched) !== JSON.stringify(theirs)) {
            const chained = (['INS_HNTCH', 'INS_HNTC2'] as const).some(
              (prefix) => inputs[`${prefix}_ENABLE`] > 0 && inputs[`${prefix}_MODE`] === 3 && (inputs[`${prefix}_OPTS`] & 2) !== 0
            )
            expect(chained && inputs.NUM_MOTORS > 1, `${label}: original differs outside the proven case`).toBe(true)
          }
        }
      },
      TIMEOUT
    )

    it.each(TUNE_AXES)(
      'saved parameter file for %s',
      (axis) => {
        // With the proven fixed-wing yaw save fix (bug-proofs/analytic-tune.md row 112), which changes
        // only fixed-wing yaw saves.
        const up = freshUpstream({ fixFixedWingYawSave: true })
        up.setPageAxis(axis)
        const saved = up.saveParameters()
        expect(saved.name).toBe('filter.param')
        expect(saveParamText(inputs, tuneTarget(loaded.vehicle, axis))).toBe(saved.text)
      },
      TIMEOUT
    )
  })
})
