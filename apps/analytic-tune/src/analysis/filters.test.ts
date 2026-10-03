import { describe, expect, it } from 'vitest'
import {
  chainResponse,
  designAngleP,
  designBiquadLowPass,
  designFeedforward,
  designFirstOrderLowPass,
  designNotchWithBandwidth,
  designNotchWithQ,
  designPid,
  frequencyGrid,
  type TransferElement
} from './filters.js'
import { unwrapPhase } from './display.js'
import { gyroFilters } from './predict.js'
import { DEFAULT_INPUTS, NOTCH_FIELDS, NOTCH_PREFIXES, notchParam, withInputs, type InputName } from './params.js'
import { expectBitEqual, expectComplexBitEqual } from './test-utils/compare.js'
import { rng } from './test-utils/random.js'
import { loadAnalyticTuneUpstream, type UpstreamFilter } from './test-utils/upstream.js'

const up = loadAnalyticTuneUpstream()

/** Model grids as the tool builds them: Nyquist and bin width of a measured log rate. */
const GRIDS = [
  { rate: 400, window: 1024 },
  { rate: 399.8734, window: 512 },
  { rate: 1000.3, window: 2048 },
  { rate: 333.33, window: 256 }
]

function compareChain(mine: TransferElement[], theirs: UpstreamFilter[], label: string): void {
  for (const g of GRIDS) {
    const max = g.rate * 0.5
    const step = g.rate / g.window
    const expected = up.evaluate_transfer_functions([theirs], max, step, false, false)
    const freq = frequencyGrid(max, step)
    expectBitEqual(freq, expected.freq, `${label} freq`)
    expectComplexBitEqual(chainResponse(freq, [mine]), expected.H_total, `${label} @${g.rate}/${g.window}`)
  }
}

describe('controller elements match upstream', () => {
  const next = rng(1)
  const pick = (lo: number, hi: number) => lo + (hi - lo) * next()

  it('PID', () => {
    for (let n = 0; n < 12; n++) {
      const rate = [400, 300, 1000, 2000][n % 4]!
      const kP = pick(0, 0.5)
      const kI = pick(0, 0.5)
      const kD = pick(0, 0.02)
      const fltE = n % 3 === 0 ? 0 : pick(0, 40)
      const fltD = n % 4 === 0 ? 0 : pick(5, 80)
      compareChain(
        [designPid(rate, { kP, kI, kD, errorCutoffHz: fltE, derivativeCutoffHz: fltD })],
        [up.PID(rate, kP, kI, kD, fltE, fltD)],
        `PID ${n}`
      )
    }
  })

  it('angle P, feedforward and first-order low-pass', () => {
    for (let n = 0; n < 8; n++) {
      const rate = [400, 300, 1000][n % 3]!
      const kP = pick(1, 12)
      compareChain([designAngleP(rate, kP)], [up.Ang_P(rate, kP)], `Ang_P ${n}`)
      const kFF = pick(0, 0.3)
      const kFFD = n % 2 === 0 ? 0 : pick(0, 0.01)
      compareChain([designFeedforward(rate, kFF, kFFD)], [up.feedforward(rate, kFF, kFFD)], `FF ${n}`)
      const cutoff = n % 3 === 0 ? 0 : pick(0.5, 60)
      compareChain([designFirstOrderLowPass(rate, cutoff)], [up.LPF_1P(rate, cutoff)], `LPF ${n}`)
    }
    compareChain([designFirstOrderLowPass(400, Infinity)], [up.LPF_1P(400, Infinity)], 'LPF infinite cut-off')
  })

  it('biquad low-pass and notches', () => {
    for (let n = 0; n < 8; n++) {
      const rate = [2000, 1000, 400][n % 3]!
      const cutoff = n % 4 === 0 ? 0 : pick(5, 200)
      compareChain([designBiquadLowPass(rate, cutoff)], [up.DigitalBiquadFilter(rate, cutoff)], `biquad ${n}`)
      const center = pick(-10, rate * 0.6)
      const q = n % 5 === 0 ? 0 : pick(0.5, 10)
      const att = pick(5, 60)
      compareChain([designNotchWithQ(rate, center, q, att)], [up.NotchFilterusingQ(rate, center, q, att)], `notch Q ${n}`)
      const bw = pick(0, center)
      // Upstream's NotchFilter has no sample_rate of its own (it only runs inside a harmonic
      // notch), so lead the group with a pass-through filter that sets the group's rate.
      compareChain(
        [designFirstOrderLowPass(rate, 0), designNotchWithBandwidth(rate, center, bw, att)],
        [up.LPF_1P(rate, 0), up.NotchFilter(rate, center, bw, att)],
        `notch bw ${n}`
      )
    }
  })

  it('chains several elements in a group', () => {
    compareChain(
      [designPid(400, { kP: 0.1, kI: 0.2, kD: 0.003, errorCutoffHz: 10, derivativeCutoffHz: 20 }), designAngleP(400, 4.5)],
      [up.PID(400, 0.1, 0.2, 0.003, 10, 20), up.Ang_P(400, 4.5)],
      'chain'
    )
  })
})

describe('gyro filters match upstream get_filters', () => {
  const next = rng(7)
  const int = (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * next())

  it.each(Array.from({ length: 40 }, (_, i) => i))('random notch configuration %i', (n) => {
    const values = new Map<InputName, number>()
    for (const prefix of NOTCH_PREFIXES) {
      for (const field of NOTCH_FIELDS) {
        const name = notchParam(prefix, field)
        const value = {
          ENABLE: n % 7 === 0 ? 0 : 1,
          MODE: int(0, 5),
          FREQ: int(20, 300),
          BW: int(5, 150),
          ATT: int(10, 50),
          REF: [0, 0.25, 1, 0.1][int(0, 3)]!,
          FM_RAT: next(),
          HMNCS: int(0, 255),
          OPTS: int(0, 31)
        }[field]
        values.set(name, value)
      }
    }
    values.set('INS_GYRO_FILTER', n % 5 === 0 ? 0 : int(10, 120))
    values.set('Throttle', next() * 1.2 - 0.1)
    values.set('RPM1', int(0, 9000))
    values.set('RPM2', int(0, 9000))
    values.set('ESC_RPM', int(0, 9000))
    values.set('NUM_MOTORS', int(1, 4))
    const inputs = withInputs(DEFAULT_INPUTS, values)
    for (const [name, value] of values) up.setForm(name, value)
    const rate = [2000, 1000, 4000, 8000][n % 4]!
    compareChain(gyroFilters(inputs, rate), up.get_filters(rate), `gyro ${n}`)
  })
})

describe('unwrapPhase', () => {
  it('matches upstream unwrap', () => {
    const next = rng(3)
    const phase = Array.from({ length: 300 }, () => next() * 360 - 180)
    expectBitEqual(unwrapPhase(phase), up.unwrap(phase), 'unwrap')
    expect(unwrapPhase([])).toHaveLength(0)
  })
})
