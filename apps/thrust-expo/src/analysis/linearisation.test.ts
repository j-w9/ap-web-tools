import { describe, expect, it } from 'vitest'
import {
  applyThrustCurve,
  correctedThrust,
  estimateHover,
  linearise,
  spinMarkers,
  type ExpoSetting,
  type OutputRange,
  type ThrustData
} from './linearisation.js'
import { EXAMPLE_SAMPLES, thrustData } from './thrust-table.js'
import { loadUpstreamPage, type UpstreamRow } from './test-support/upstream.js'

const DEFAULT_RANGE: OutputRange = { spinMin: 0.15, spinMax: 0.95, pwmMin: 1000, pwmMax: 2000 }

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Synthetic stand data: thrust rising roughly quadratically with PWM, with noise. */
function syntheticRows(seed: number, n: number): UpstreamRow[] {
  const next = rng(seed)
  const rows: UpstreamRow[] = []
  let pwm = 1000
  for (let i = 0; i < n; i++) {
    pwm += 5 + Math.round(next() * 20)
    const x = (pwm - 1000) / 1000
    rows.push({ pwm, thrust: 0.1 + 3 * x * x + 0.5 * x + 0.02 * next(), voltage: 16, current: 0 })
  }
  return rows
}

function toData(rows: UpstreamRow[]): ThrustData {
  return thrustData(rows.map((r) => ({ pwm: r.pwm, thrust: r.thrust, voltage: '', current: '' })))
}

interface Scenario {
  rows: UpstreamRow[]
  range: OutputRange
  spinArm: number
  expo: number | null
  auw: number
  motors: number
}

function runBoth(s: Scenario) {
  const page = loadUpstreamPage()
  const p = page.api.params
  p.MOT_SPIN_ARM!.value = s.spinArm
  p.MOT_SPIN_MIN!.value = s.range.spinMin
  p.MOT_SPIN_MAX!.value = s.range.spinMax
  p.MOT_PWM_MIN!.value = s.range.pwmMin
  p.MOT_PWM_MAX!.value = s.range.pwmMax
  p.COPTER_AUW!.value = s.auw
  p.MOTOR_COUNT!.value = s.motors
  page.setRows(s.rows)
  page.api.updatePlotData(s.expo)
  const setting: ExpoSetting = s.expo === null ? { kind: 'fit' } : { kind: 'fixed', expo: s.expo }
  const lin = linearise(toData(s.rows), s.range, setting)
  return { page, lin }
}

function expectSame(s: Scenario) {
  const { page, lin } = runBoth(s)
  if (!lin) throw new Error('no linearisation')
  const expo = page.api.thrustExpoPlot.data
  expect(Array.from(lin.throttlePct)).toEqual(Array.from(expo[0]!.x))
  expect(Array.from(lin.uncorrectedThrust)).toEqual(Array.from(expo[0]!.y))
  expect(Array.from(lin.result.correctedThrust)).toEqual(Array.from(expo[1]!.y))
  expect(lin.result.expo).toBe(page.api.params.MOT_THST_EXPO!.value)

  const err = page.api.thrustErrorPlot
  expect(Array.from(lin.gradientThrottlePct)).toEqual(Array.from(err.data[0]!.x))
  expect(Array.from(lin.result.gradient)).toEqual(Array.from(err.data[0]!.y))
  expect(err.data[0]!.name).toBe('Linearized Thrust<br>Std dev: ' + lin.result.stdDeviation.toFixed(3))
  expect(lin.result.mean).toBe(err.layout.shapes![0]!.y0)

  const hover = estimateHover(lin, s.auw, s.motors)
  const marker = expo[2]
  if (hover) {
    expect(marker?.name).toBe('THST_HOVER')
    expect(hover.throttlePct).toBe(marker!.x[0])
    expect(hover.requiredThrust).toBe(marker!.y[0])
    expect(hover.motThstHover).toBe(page.api.params.MOT_THST_HOVER!.value)
  } else {
    expect(marker).toBeUndefined()
  }
  return lin
}

const exampleRows: UpstreamRow[] = EXAMPLE_SAMPLES.map((s) => ({ ...s }))

describe('linearise matches upstream updateThrustExpoPlot', () => {
  it('fits the example data', () => {
    const lin = expectSame({ rows: exampleRows, range: DEFAULT_RANGE, spinArm: 0.1, expo: null, auw: 2.5, motors: 4 })
    expect(lin.setting).toBe('fit')
    expect(lin.result.expo).toBeGreaterThan(-1)
    expect(lin.result.expo).toBeLessThan(1)
    expect(estimateHover(lin, 2.5, 4)).not.toBeNull()
  })

  it('uses a fixed expo', () => {
    const lin = expectSame({ rows: exampleRows, range: DEFAULT_RANGE, spinArm: 0.1, expo: 0.42, auw: 2.5, motors: 4 })
    expect(lin.result.expo).toBe(0.42)
    expect(lin.setting).toBe('fixed')
  })

  it('matches on synthetic data with other ranges and hover inputs', () => {
    const cases: Scenario[] = [
      { rows: syntheticRows(1, 40), range: DEFAULT_RANGE, spinArm: 0.1, expo: null, auw: 3, motors: 4 },
      {
        rows: syntheticRows(2, 60),
        range: { spinMin: 0.1, spinMax: 0.9, pwmMin: 1100, pwmMax: 1900 },
        spinArm: 0.05,
        expo: null,
        auw: 5,
        motors: 6
      },
      { rows: syntheticRows(3, 25), range: DEFAULT_RANGE, spinArm: 0.1, expo: -0.3, auw: 0, motors: 4 },
      // hover thrust above the curve: no estimate
      { rows: syntheticRows(4, 30), range: DEFAULT_RANGE, spinArm: 0.1, expo: null, auw: 1000, motors: 4 }
    ]
    for (const c of cases) expectSame(c)
  })

  it('returns null without data', () => {
    expect(linearise(toData([]), DEFAULT_RANGE, { kind: 'fit' })).toBeNull()
  })

  it('refits for a manual expo of NaN (an empty input), as upstream `if (thrustExpo)` does', () => {
    const lin = expectSame({ rows: exampleRows, range: DEFAULT_RANGE, spinArm: 0.1, expo: Number.NaN, auw: 2.5, motors: 4 })
    expect(lin.setting).toBe('fit')
    expect(lin.result.expo).not.toBe(0)
  })

  it('keeps a manual expo of 0, which upstream refits (proven upstream bug fixed)', () => {
    const { page, lin } = runBoth({ rows: exampleRows, range: DEFAULT_RANGE, spinArm: 0.1, expo: 0, auw: 2.5, motors: 4 })
    // Upstream: `if (thrustExpo)` is false for 0, so it fits instead.
    expect(page.api.params.MOT_THST_EXPO!.value).toBe(0.38500000000000106)
    // Port: 0 (linear) is used as given.
    expect(lin?.setting).toBe('fixed')
    expect(lin?.result.expo).toBe(0)
  })
})

describe('thrust curve', () => {
  it('is linear at zero expo and maps the end points', () => {
    expect(applyThrustCurve(0.3, 0)).toBe(0.3)
    expect(applyThrustCurve(0, 0.65)).toBeCloseTo(0, 12)
    expect(applyThrustCurve(1, 0.65)).toBeCloseTo(1, 12)
  })

  it('gives a perfectly constant gradient when the data follows the expo curve', () => {
    // thrust = (1 - e) * t + e * t^2 for throttle t across the spin range
    const e = 0.5
    const pwm: number[] = []
    const thrust: number[] = []
    for (let i = 0; i <= 200; i++) {
      const t = i / 200
      pwm.push(1000 + 1000 * (0.15 + 0.8 * t))
      thrust.push((1 - e) * t + e * t * t)
    }
    const data = { pwm: Float64Array.from(pwm), thrust: Float64Array.from(thrust) }
    const exact = correctedThrust(data, DEFAULT_RANGE, e)
    expect(exact.stdDeviation).toBeLessThan(0.01)
    const lin = linearise(data, DEFAULT_RANGE, { kind: 'fit' })
    expect(lin?.result.expo).toBeCloseTo(e, 2)
  })
})

describe('spinMarkers', () => {
  it('matches upstream createSpinMarkers on both axes', () => {
    const page = loadUpstreamPage()
    const p = page.api.params
    p.MOT_SPIN_ARM!.value = 0.07
    p.MOT_SPIN_MIN!.value = 0.12
    p.MOT_SPIN_MAX!.value = 0.93
    p.MOT_PWM_MIN!.value = 1100
    p.MOT_PWM_MAX!.value = 1940
    const params = { spinArm: 0.07, spinMin: 0.12, spinMax: 0.93, pwmMin: 1100, pwmMax: 1940 }
    for (const axis of ['pwm', 'percent'] as const) {
      const upstream = page.api.createSpinMarkers(axis === 'pwm')
      const ours = spinMarkers(params, axis)
      expect(ours.map((m) => m.x)).toEqual(upstream.shapes.map((s) => s.x0))
      expect(ours.map((m) => m.key)).toEqual(upstream.annotations.map((a) => a.text))
    }
  })
})
