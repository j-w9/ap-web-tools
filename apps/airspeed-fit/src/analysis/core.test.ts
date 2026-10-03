/** Bit-identical oracle tests of the numeric core against upstream airspeedfit_core.js. */
import { describe, expect, it } from 'vitest'
import { expectSameArray, expectSameNumber } from '../test-utils/compare.js'
import { rng } from '../test-utils/synthetic-log.js'
import { loadUpstreamCore } from '../test-utils/upstream.js'
import {
  airTemperatureC,
  autoWindow,
  calibrate,
  calibrateCombined,
  courseSpreadDeg,
  densityAltitudeM,
  eas2tas,
  fitWarningText,
  isaTemperatureAtAltC,
  refine,
  windSmoother,
  type ConstantWindFit
} from './core.js'
import type { UpCal } from '../test-utils/upstream.js'

const up = loadUpstreamCore()

interface Flight {
  t: Float64Array
  vn: Float64Array
  ve: Float64Array
  vd: Float64Array
  u: Float64Array[]
}

/** A turning flight in a drifting wind seen by sensors with the given ratios. */
function flight(n: number, ratios: readonly number[], seed: number, options: { straight?: boolean; dt?: number } = {}): Flight {
  const next = rng(seed)
  const dt = options.dt ?? 0.1
  const f: Flight = {
    t: new Float64Array(n),
    vn: new Float64Array(n),
    ve: new Float64Array(n),
    vd: new Float64Array(n),
    u: ratios.map(() => new Float64Array(n))
  }
  for (let i = 0; i < n; i++) {
    const t = i * dt + (next() - 0.5) * 0.002
    const tas = 18 + 4 * Math.sin(t / 23)
    const heading = options.straight ? 0.3 : t / 6 + 0.5 * Math.sin(t / 11)
    const wn = 4 + Math.sin(t / 90)
    const we = -2 + 0.5 * Math.cos(t / 70)
    f.t[i] = t
    f.vn[i] = tas * Math.cos(heading) + wn
    f.ve[i] = tas * Math.sin(heading) + we
    f.vd[i] = Math.sin(t / 9)
    ratios.forEach((r, s) => {
      f.u[s]![i] = (Math.hypot(tas, f.vd[i]!) + (next() - 0.5) * 0.6) / Math.sqrt(r)
    })
  }
  return f
}

function compareCal(mine: ConstantWindFit, theirs: UpCal, label: string): void {
  expectSameNumber(mine.ratio, theirs.ratio, `${label} ratio`)
  expectSameNumber(mine.k, theirs.k, `${label} k`)
  expectSameNumber(mine.ratioStderr, theirs.ratio_stderr, `${label} stderr`)
  expectSameArray(mine.wind, theirs.wind_ne, `${label} wind`)
  expectSameNumber(mine.residualRms, theirs.residual_rms, `${label} rms`)
  expectSameNumber(mine.courseSpreadDeg, theirs.course_spread_deg, `${label} spread`)
  expect(mine.nSamples).toBe(theirs.n_samples)
  expect(mine.warnings.map(fitWarningText)).toEqual(theirs.warnings)
}

describe('physics', () => {
  it('matches upstream bit for bit', () => {
    for (const alt of [-100, 0, 584, 2500.5, 8000]) {
      expectSameNumber(isaTemperatureAtAltC(alt), up.isa_temperature_at_alt_c(alt), `isa ${alt}`)
      expectSameNumber(airTemperatureC(17.3, alt), up.air_temperature_c(17.3, alt), `air ${alt}`)
      expectSameNumber(airTemperatureC(17.3, alt, 0.01), up.air_temperature_c(17.3, alt, 0.01), `air lapse ${alt}`)
    }
    for (const [p, t] of [
      [101325, 15],
      [95000, 30.5],
      [70000, -12]
    ] as const) {
      const e = eas2tas(p, t)
      expectSameNumber(e, up.eas2tas(p, t), `eas2tas ${p}`)
      expectSameNumber(densityAltitudeM(e), up.density_altitude_m(e), `density altitude ${p}`)
    }
  })

  it('ISA sea level is 15 C and EAS2TAS 1', () => {
    expect(isaTemperatureAtAltC(0)).toBeCloseTo(15, 12)
    expect(eas2tas(101325, 15)).toBeCloseTo(1, 3)
    expect(densityAltitudeM(1)).toBeCloseTo(0, 9)
  })
})

describe('autoWindow', () => {
  it('matches upstream and finds the fast stretch', () => {
    const t = Float64Array.from({ length: 200 }, (_, i) => i)
    const dp = Float64Array.from(t, (x) => (x > 40 && x < 150 ? 200 : 3))
    const mine = autoWindow(t, dp, 10, 190)
    const theirs = up.auto_window(t, dp, 10, 190)
    expect(mine).toEqual({ start: theirs.start, end: theirs.end, meanDp: theirs.mean_dp })
    expect([mine.start, mine.end]).toEqual([41, 149])
  })

  it('throws like upstream without data', () => {
    const t = Float64Array.of(0, 1, 2)
    expect(() => autoWindow(t, Float64Array.of(1, 1, 1), 5, 6)).toThrow('no differential-pressure samples')
    expect(() => autoWindow(t, Float64Array.of(0, 0, 0), 0, 6)).toThrow('never exceeds')
  })
})

describe('constant-wind fit', () => {
  it('courseSpreadDeg matches upstream', () => {
    const f = flight(500, [2], 1)
    expectSameNumber(courseSpreadDeg(f.vn, f.ve), up.course_spread_deg(f.vn, f.ve), 'spread')
  })

  it('refine matches upstream including covariance', () => {
    const f = flight(800, [2], 2)
    const mine = refine(f.vn, f.ve, f.vd, f.u[0]!, 0, 0, 1.3)
    const theirs = up.refine(f.vn, f.ve, f.vd, f.u[0]!, 0, 0, 1.3)
    expectSameNumber(mine.windNorth, theirs.Wn, 'Wn')
    expectSameNumber(mine.windEast, theirs.We, 'We')
    expectSameNumber(mine.k, theirs.k, 'k')
    expectSameNumber(mine.residualRms, theirs.residual_rms, 'rms')
    mine.cov.forEach((row, a) => expectSameArray(row, theirs.cov[a], `cov ${a}`))
  })

  it('calibrate matches upstream and recovers the ratio', () => {
    const f = flight(1500, [2.1], 3)
    const mine = calibrate(f.vn, f.ve, f.vd, f.u[0]!)
    compareCal(mine, up.calibrate(f.vn, f.ve, f.vd, f.u[0]!), 'cal')
    expect(mine.ratio).toBeCloseTo(2.1, 1)
    expect(mine.warnings).toEqual([])
  })

  it('warns like upstream on a straight leg and on a singular fit', () => {
    const f = flight(300, [2], 4, { straight: true })
    const mine = calibrate(f.vn, f.ve, f.vd, f.u[0]!)
    compareCal(mine, up.calibrate(f.vn, f.ve, f.vd, f.u[0]!), 'straight')
    expect(mine.warnings.map((w) => w.kind)).toContain('littleCourseVariation')

    // Constant velocity: the normal equations are singular from the start.
    const c = Float64Array.from({ length: 10 }, () => 5)
    const z = new Float64Array(10)
    const singular = calibrate(c, c, z, c)
    compareCal(singular, up.calibrate(c, c, z, c), 'singular')
    expect(singular.ratioStderr).toBeNaN()
  })

  it('needs four samples', () => {
    const a = Float64Array.of(1, 2, 3)
    expect(() => calibrate(a, a, a, a)).toThrow('need at least 4 samples to solve, got 3')
  })
})

describe('wind smoother and combined fit', () => {
  it('windSmoother matches upstream', () => {
    const f = flight(400, [2], 5, { dt: 0.5 })
    const x0 = [1, -1] as const
    const p0 = [
      [25, 0],
      [0, 25]
    ] as const
    const mine = windSmoother(0.5, f.vn, f.ve, f.vd, f.u[0]!, 1.41, 0.05, 0.4, x0, p0, 4)
    const theirs = up.wind_smoother(
      0.5,
      f.vn,
      f.ve,
      f.vd,
      f.u[0]!,
      1.41,
      0.05,
      0.4,
      [1, -1],
      [
        [25, 0],
        [0, 25]
      ],
      4
    )
    expectSameArray(
      mine.north,
      theirs.xs.map((x) => x[0]),
      'north'
    )
    expectSameArray(
      mine.east,
      theirs.xs.map((x) => x[1]),
      'east'
    )
    expectSameArray(
      mine.pNN,
      theirs.Ps.map((p) => p[0][0]),
      'pNN'
    )
    expectSameArray(
      mine.pNE,
      theirs.Ps.map((p) => p[0][1]),
      'pNE'
    )
    expectSameArray(
      mine.pEN,
      theirs.Ps.map((p) => p[1][0]),
      'pEN'
    )
    expectSameArray(
      mine.pEE,
      theirs.Ps.map((p) => p[1][1]),
      'pEE'
    )
  })

  it('calibrateCombined matches upstream for one and two sensors and several q', () => {
    for (const [ratios, q] of [
      [[2.0], 0.02],
      [[1.8, 2.4], 0.0316],
      [[1.8, 2.4], 0.5]
    ] as const) {
      const f = flight(6000, ratios, 6)
      const mineSeeds = f.u.map((u) => calibrate(f.vn, f.ve, f.vd, u))
      const upSeeds = f.u.map((u) => up.calibrate(f.vn, f.ve, f.vd, u))
      const mine = calibrateCombined(f.t, f.vn, f.ve, f.vd, f.u, mineSeeds, { qWind: q })
      const theirs = up.calibrate_combined(f.t, f.vn, f.ve, f.vd, f.u, upSeeds, { q_wind: q })
      const label = `${ratios.length} sensors q ${q}`
      expectSameArray(mine.t, theirs.t, `${label} t`)
      expectSameArray(
        mine.windNorth,
        theirs.wind_ne.map((w) => w[0]),
        `${label} wn`
      )
      expectSameArray(
        mine.windEast,
        theirs.wind_ne.map((w) => w[1]),
        `${label} we`
      )
      expectSameArray(
        mine.windSigmaNorth,
        theirs.wind_sigma.map((w) => w[0]),
        `${label} sn`
      )
      expectSameArray(
        mine.windSigmaEast,
        theirs.wind_sigma.map((w) => w[1]),
        `${label} se`
      )
      expectSameArray(mine.truth, theirs.D, `${label} D`)
      expectSameNumber(mine.windDrift, theirs.wind_drift, `${label} drift`)
      expectSameNumber(mine.rMeas, theirs.r_meas, `${label} r`)
      expect(mine.iterations).toBe(theirs.iterations)
      expect(mine.nSamples).toBe(theirs.n_samples)
      mine.sensors.forEach((s, i) => {
        const o = theirs.per_sensor[i]!
        expectSameNumber(s.k, o.k, `${label} k${i}`)
        expectSameNumber(s.ratio, o.ratio, `${label} ratio${i}`)
        expectSameNumber(s.ratioStderr, o.ratio_stderr, `${label} stderr${i}`)
        expectSameNumber(s.residualRms, o.residual_rms, `${label} rms${i}`)
        expectSameArray(s.u, o.u, `${label} u${i}`)
        expectSameArray(s.predicted, o.pred, `${label} pred${i}`)
        expectSameArray(s.residual, o.resid, `${label} resid${i}`)
        expect(s.ratio).toBeCloseTo(ratios[i]!, 1)
      })
    }
  })

  it('honours maxSamples decimation like upstream', () => {
    const f = flight(3000, [2], 8, { dt: 1 })
    const seeds = [calibrate(f.vn, f.ve, f.vd, f.u[0]!)]
    const mine = calibrateCombined(f.t, f.vn, f.ve, f.vd, f.u, seeds, { maxSamples: 700, targetRateHz: 5, maxOuter: 2 })
    const theirs = up.calibrate_combined(f.t, f.vn, f.ve, f.vd, f.u, [up.calibrate(f.vn, f.ve, f.vd, f.u[0]!)], {
      max_samples: 700,
      target_rate_hz: 5,
      max_outer: 2
    })
    expectSameArray(mine.truth, theirs.D, 'D')
    expect(mine.iterations).toBe(theirs.iterations)
  })
})
