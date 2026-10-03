import { arrayScale, complexAbs, complexPhase } from '@apwt/signal'
import { describe, it } from 'vitest'
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
  pidResponse,
  zGrid,
  type TransferElement
} from './index.js'
import { expectBitEqual, expectComplexBitEqual } from './test-utils/compare.js'
import { rng } from './test-utils/random.js'
import { evaluateUpstream, loadUpstream, type UpstreamScript } from './test-utils/upstream.js'

/** Model grids as AnalyticTune builds them: Nyquist and bin width of a measured log rate. */
const GRIDS = [
  { rate: 400, window: 1024 },
  { rate: 399.8734, window: 512 },
  { rate: 1000.3, window: 2048 },
  { rate: 333.33, window: 256 }
]

/** Compare the chain response with upstream AnalyticTune `evaluate_transfer_functions` (which returns H). */
function compareH(up: UpstreamScript, mine: TransferElement[], theirs: string, label: string): void {
  for (const g of GRIDS) {
    const max = g.rate * 0.5
    const step = g.rate / g.window
    const expected = evaluateUpstream(up, theirs, max, step)
    const freq = frequencyGrid(max, step)
    expectBitEqual(freq, expected.freq, `${label} freq`)
    expectComplexBitEqual(chainResponse(freq, [mine]), expected.H_total!, `${label} @${g.rate}/${g.window}`)
  }
}

describe('elements match upstream AnalyticTune', () => {
  const up = loadUpstream('AnalyticTune')
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
      compareH(
        up,
        [designPid(rate, { kP, kI, kD, errorCutoffHz: fltE, derivativeCutoffHz: fltD })],
        `new PID(${rate}, ${kP}, ${kI}, ${kD}, ${fltE}, ${fltD})`,
        `PID ${n}`
      )
    }
  })

  it('angle P, feedforward and first-order low-pass', () => {
    for (let n = 0; n < 8; n++) {
      const rate = [400, 300, 1000][n % 3]!
      const kP = pick(1, 12)
      compareH(up, [designAngleP(rate, kP)], `new Ang_P(${rate}, ${kP})`, `Ang_P ${n}`)
      const kFF = pick(0, 0.3)
      const kFFD = n % 2 === 0 ? 0 : pick(0, 0.01)
      compareH(up, [designFeedforward(rate, kFF, kFFD)], `new feedforward(${rate}, ${kFF}, ${kFFD})`, `FF ${n}`)
      const cutoff = n % 3 === 0 ? 0 : pick(0.5, 60)
      compareH(up, [designFirstOrderLowPass(rate, cutoff)], `new LPF_1P(${rate}, ${cutoff})`, `LPF ${n}`)
    }
    compareH(up, [designFirstOrderLowPass(400, Infinity)], 'new LPF_1P(400, Infinity)', 'LPF infinite cut-off')
  })

  it('biquad low-pass and notches', () => {
    for (let n = 0; n < 8; n++) {
      const rate = [2000, 1000, 400][n % 3]!
      const cutoff = n % 4 === 0 ? 0 : pick(5, 200)
      compareH(up, [designBiquadLowPass(rate, cutoff)], `new DigitalBiquadFilter(${rate}, ${cutoff})`, `biquad ${n}`)
      const center = pick(-10, rate * 0.6)
      const q = n % 5 === 0 ? 0 : pick(0.5, 10)
      const att = pick(5, 60)
      compareH(
        up,
        [designNotchWithQ(rate, center, q, att)],
        `new NotchFilterusingQ(${rate}, ${center}, ${q}, ${att})`,
        `notch Q ${n}`
      )
      const bw = pick(0, center)
      // Upstream's NotchFilter has no sample_rate of its own (it only runs inside a harmonic
      // notch), so lead the group with a pass-through filter that sets the group's rate.
      compareH(
        up,
        [designFirstOrderLowPass(rate, 0), designNotchWithBandwidth(rate, center, bw, att)],
        `new LPF_1P(${rate}, 0), new NotchFilter(${rate}, ${center}, ${bw}, ${att})`,
        `notch bw ${n}`
      )
    }
  })

  it('chains several elements in a group', () => {
    compareH(
      up,
      [designPid(400, { kP: 0.1, kI: 0.2, kD: 0.003, errorCutoffHz: 10, derivativeCutoffHz: 20 }), designAngleP(400, 4.5)],
      'new PID(400, 0.1, 0.2, 0.003, 10, 20), new Ang_P(400, 4.5)',
      'chain'
    )
  })
})

describe('elements match upstream FilterTool', () => {
  const up = loadUpstream('FilterTool')
  const next = rng(2)
  const pick = (lo: number, hi: number) => lo + (hi - lo) * next()

  /** FilterTool's `evaluate_transfer_functions` returns magnitude and wrapped phase (deg), not H. */
  function compareBode(mine: TransferElement[], theirs: string, rate: number, step: number, label: string): void {
    const expected = evaluateUpstream(up, theirs, rate * 0.5, step)
    const freq = frequencyGrid(rate * 0.5, step)
    const h = chainResponse(freq, [mine])
    expectBitEqual(freq, expected.freq, `${label} freq`)
    expectBitEqual(complexAbs(h), expected.attenuation, `${label} magnitude`)
    expectBitEqual(arrayScale(complexPhase(h), 180 / Math.PI), expected.phase, `${label} phase`)
  }

  it('PID, low-pass and notch', () => {
    for (let n = 0; n < 8; n++) {
      const rate = [400, 1000, 2000][n % 3]!
      const kP = pick(0, 0.5)
      const kI = pick(0, 0.5)
      const kD = pick(0, 0.02)
      const fltE = n % 3 === 0 ? 0 : pick(0, 40)
      const fltD = n % 4 === 0 ? 0 : pick(5, 80)
      compareBode(
        [designPid(rate, { kP, kI, kD, errorCutoffHz: fltE, derivativeCutoffHz: fltD })],
        `new PID(${rate}, ${kP}, ${kI}, ${kD}, ${fltE}, ${fltD})`,
        rate,
        0.05,
        `PID ${n}`
      )
      const cutoff = n % 4 === 0 ? 0 : pick(5, 200)
      compareBode([designBiquadLowPass(rate, cutoff)], `new DigitalBiquadFilter(${rate}, ${cutoff})`, rate, 0.1, `lp ${n}`)
      const center = pick(-10, rate * 0.6)
      const bw = pick(0, center)
      const att = pick(5, 60)
      // FilterTool's LPF_1P with no cut-off never sets its sample_rate, so a unit-gain PID
      // leads the group to give it the rate.
      compareBode(
        [
          designPid(rate, { kP: 1, kI: 0, kD: 0, errorCutoffHz: 0, derivativeCutoffHz: 0 }),
          designNotchWithBandwidth(rate, center, bw, att)
        ],
        `new PID(${rate}, 1, 0, 0, 0, 0), new NotchFilter(${rate}, ${center}, ${bw}, ${att})`,
        rate,
        0.1,
        `notch ${n}`
      )
    }
  })

  it('PID terms sum to the total', () => {
    const terms = pidResponse(
      designPid(400, { kP: 0.1, kI: 0.2, kD: 0.003, errorCutoffHz: 10, derivativeCutoffHz: 20 }),
      zGrid([1, 10, 100], 400)
    )
    for (let n = 0; n < 3; n++) {
      expectBitEqual([terms.total.re[n]!], [terms.p.re[n]! + terms.i.re[n]! + terms.d.re[n]!], `total ${n}`)
    }
  })
})
