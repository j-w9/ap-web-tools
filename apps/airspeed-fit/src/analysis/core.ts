/**
 * AirspeedFit numeric core, ported from upstream `AirspeedFit/airspeedfit_core.js`.
 *
 * ArduPilot computes airspeed as
 *
 *     EAS = sqrt(dpress * ARSPD_RATIO)      // equivalent airspeed
 *     TAS = EAS * EAS2TAS                    // true airspeed
 *
 * The wind triangle Vg = Va + W, taken magnitude only, with a horizontal wind W = (Wn, We) gives
 * |Vg - W| = TAS. The airspeed ratio and a model of the wind over time are optimised iteratively
 * to minimise the residuals of that equation over a flight span.
 *
 * Every function here performs the same floating-point operations in the same order as upstream,
 * so results are bit-identical (see `core.test.ts`). Upstream's per-sample `[x, y]` pairs and 2x2
 * matrices are held as parallel `Float64Array` columns; the arithmetic is unchanged.
 */
import { Matrix, inverse, solve } from 'ml-matrix'

// Physical constants, matched to ArduPilot (AP_Baro / AP_Math).
/** Sea-level standard air density, kg/m^3. */
export const SSL_AIR_DENSITY = 1.225
/** Specific gas constant for air, J/(kg.K). */
export const ISA_GAS_CONSTANT = 287.05
/** Standard tropospheric lapse rate, K/m. */
export const ISA_LAPSE_RATE = 0.0065
const C_TO_KELVIN = 273.15
/** ISA sea-level temperature (15 C). */
const ISA_SSL_TEMP_K = 288.15
const STANDARD_GRAVITY = 9.80665

/** Default wind random-walk process noise for the smoother, (m/s) per sqrt(s). */
export const DEFAULT_Q_WIND = 0.02

/** A horizontal vector as (north, east). */
export type NorthEast = readonly [north: number, east: number]

/** A 2x2 matrix, row major. */
export type Matrix2 = readonly [readonly [number, number], readonly [number, number]]

// --- physics ---------------------------------------------------------------

/** ISA air temperature (deg C) at a geometric altitude (m AMSL). Upstream `isa_temperature_at_alt_c`. */
export function isaTemperatureAtAltC(altM: number): number {
  return ISA_SSL_TEMP_K - C_TO_KELVIN - ISA_LAPSE_RATE * altM
}

/**
 * Outside air temperature at a height above the ground from a ground-level temperature,
 * T(h) = T_ground - lapse_rate * h, matching `AP_Baro::get_EAS2TAS_simple`. Upstream `air_temperature_c`.
 */
export function airTemperatureC(groundTempC: number, relAltM: number, lapseRate: number = ISA_LAPSE_RATE): number {
  return groundTempC - lapseRate * relAltM
}

/** Equivalent-to-true airspeed scale, sqrt(rho_ssl / rho) with rho = P / (R T). Mirrors `AP_Baro::get_EAS2TAS_simple`. */
export function eas2tas(staticPressurePa: number, temperatureC: number): number {
  const tempK = temperatureC + C_TO_KELVIN
  const rho = staticPressurePa / (ISA_GAS_CONSTANT * tempK)
  return Math.sqrt(SSL_AIR_DENSITY / rho)
}

/** Density altitude (m) implied by an EAS2TAS scale, for reference. Upstream `density_altitude_m`. */
export function densityAltitudeM(eas2tasScale: number): number {
  const n = STANDARD_GRAVITY / (ISA_GAS_CONSTANT * ISA_LAPSE_RATE) - 1.0
  const rhoRatio = 1.0 / (eas2tasScale * eas2tasScale)
  return (ISA_SSL_TEMP_K / ISA_LAPSE_RATE) * (1.0 - Math.pow(rhoRatio, 1.0 / n))
}

/** Result of {@link autoWindow}, in the same time units as its input. */
export interface AutoWindow {
  readonly start: number
  readonly end: number
  /** Mean differential pressure over the flight span. */
  readonly meanDp: number
}

/**
 * Heuristic fit window from differential pressure over the flight span: from the first time
 * dpress rises above a quarter of its flight mean to the last time it is above it (dpress goes as
 * speed squared, so a quarter of the mean dpress is half the mean speed). Throws when there is no
 * usable data. Upstream `auto_window`.
 */
export function autoWindow(t: ArrayLike<number>, dpress: ArrayLike<number>, flightLo: number, flightHi: number): AutoWindow {
  let sum = 0
  let n = 0
  for (let i = 0; i < t.length; i++) {
    if (t[i]! < flightLo || t[i]! > flightHi) continue
    sum += dpress[i]!
    n++
  }
  if (n === 0) throw new Error('no differential-pressure samples within the flight span')
  const meanDp = sum / n
  const threshold = 0.25 * meanDp

  let i0 = -1
  let i1 = -1
  for (let i = 0; i < t.length; i++) {
    if (t[i]! < flightLo || t[i]! > flightHi) continue
    if (dpress[i]! > threshold) {
      if (i0 < 0) i0 = i
      i1 = i
    }
  }
  if (i0 < 0) throw new Error('DiffPress never exceeds a quarter of its flight mean')
  return { start: t[i0]!, end: t[i1]!, meanDp }
}

// --- constant-wind batch solve ---------------------------------------------

/** Angular spread (deg) of horizontal ground-course directions (circular standard deviation). */
export function courseSpreadDeg(vn: ArrayLike<number>, ve: ArrayLike<number>): number {
  let sc = 0
  let ss = 0
  const n = vn.length
  for (let i = 0; i < n; i++) {
    const ang = Math.atan2(ve[i]!, vn[i]!)
    sc += Math.cos(ang)
    ss += Math.sin(ang)
  }
  let r = Math.hypot(sc / n, ss / n)
  r = Math.min(Math.max(r, 1e-9), 1.0)
  const circStd = Math.sqrt(-2.0 * Math.log(r))
  return (circStd * 180) / Math.PI
}

/** Result of {@link refine}. */
export interface RefineResult {
  readonly windNorth: number
  readonly windEast: number
  /** Airspeed scale, sqrt(ARSPD_RATIO). */
  readonly k: number
  readonly residualRms: number
  /** 3x3 parameter covariance over [Wn, We, k]; all NaN when the normal equations are singular. */
  readonly cov: readonly (readonly number[])[]
}

/**
 * Gauss-Newton refinement of the residual r = |Vg - W| - k u over [Wn, We, k]. Upstream `refine`;
 * the 3x3 solves use ml-matrix exactly as upstream does.
 */
export function refine(
  vn: ArrayLike<number>,
  ve: ArrayLike<number>,
  vd: ArrayLike<number>,
  u: ArrayLike<number>,
  wn: number,
  we: number,
  k: number,
  iters = 20,
  tol = 1e-9
): RefineResult {
  const n = u.length
  let p0 = wn
  let p1 = we
  let p2 = k
  for (let it = 0; it < iters; it++) {
    const { jtj, jtr } = normalEquations(vn, ve, vd, u, p0, p1, p2)
    let step: number[]
    try {
      step = solve(new Matrix(jtj), Matrix.columnVector(jtr)).to1DArray()
    } catch {
      break // singular normal equations
    }
    const [s0 = NaN, s1 = NaN, s2 = NaN] = step
    p0 = p0 - s0
    p1 = p1 - s1
    p2 = p2 - s2
    if (Math.hypot(s0, s1, s2) < tol) break
  }
  // final residuals + covariance
  const { jtj, rss } = normalEquations(vn, ve, vd, u, p0, p1, p2)
  const dof = Math.max(n - 3, 1)
  const sigma2 = rss / dof
  let cov: number[][] = [
    [NaN, NaN, NaN],
    [NaN, NaN, NaN],
    [NaN, NaN, NaN]
  ]
  try {
    cov = inverse(new Matrix(jtj))
      .to2DArray()
      .map((row) => row.map((v) => v * sigma2))
  } catch {
    // singular JtJ: covariance stays NaN
  }
  return { windNorth: p0, windEast: p1, k: p2, residualRms: Math.sqrt(rss / n), cov }
}

/** J^T J, J^T r and the residual sum of squares at [p0, p1, p2] (shared by both passes of `refine`). */
function normalEquations(
  vn: ArrayLike<number>,
  ve: ArrayLike<number>,
  vd: ArrayLike<number>,
  u: ArrayLike<number>,
  p0: number,
  p1: number,
  p2: number
): { jtj: number[][]; jtr: number[]; rss: number } {
  const jtj = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ]
  const jtr = [0, 0, 0]
  let rss = 0
  const j = [0, 0, 0]
  for (let i = 0; i < u.length; i++) {
    const dn = vn[i]! - p0
    const de = ve[i]! - p1
    let d = Math.sqrt(dn * dn + de * de + vd[i]! * vd[i]!)
    if (d < 1e-6) d = 1e-6
    const ri = d - p2 * u[i]!
    rss += ri * ri
    j[0] = -dn / d
    j[1] = -de / d
    j[2] = -u[i]!
    for (let a = 0; a < 3; a++) {
      jtr[a]! += j[a]! * ri
      const row = jtj[a]!
      for (let b = 0; b < 3; b++) row[b]! += j[a]! * j[b]!
    }
  }
  return { jtj, jtr, rss }
}

/** Why a constant-wind fit may be unreliable. Each variant carries the number its message quotes. */
export type FitWarning =
  | { readonly kind: 'nonPositiveRatio'; readonly ratio: number }
  | { readonly kind: 'littleCourseVariation'; readonly spreadDeg: number }
  | { readonly kind: 'weaklyDetermined'; readonly stderrFraction: number }

/** The warning text upstream shows for a {@link FitWarning}. */
export function fitWarningText(w: FitWarning): string {
  switch (w.kind) {
    case 'nonPositiveRatio':
      return `fit gave a non-positive ratio (${w.ratio.toFixed(3)}); geometry is likely under-excited or the data is bad`
    case 'littleCourseVariation':
      return `little course variation (${w.spreadDeg.toFixed(0)} deg); window may not contain enough turning to observe wind`
    case 'weaklyDetermined':
      return `ratio weakly determined (+/-${(100 * w.stderrFraction).toFixed(0)}%); wind and ratio are weakly separated -- fly turns / vary speed`
  }
}

/** Constant-wind calibration of one sensor (upstream `calibrate` result). */
export interface ConstantWindFit {
  /** Fitted ARSPD_RATIO, k squared. */
  readonly ratio: number
  /** Airspeed scale, sqrt(ARSPD_RATIO). */
  readonly k: number
  /** One-sigma standard error of the ratio; NaN when the covariance is singular. */
  readonly ratioStderr: number
  readonly wind: NorthEast
  readonly residualRms: number
  readonly nSamples: number
  readonly courseSpreadDeg: number
  readonly warnings: readonly FitWarning[]
}

export interface CalibrateOptions {
  /** Warn when the course spread is at or below this (deg). Default 10. */
  readonly courseSpreadWarnDeg?: number
  /** Warn when the ratio's relative standard error reaches this. Default 0.1. */
  readonly ratioStderrFracWarn?: number
}

/**
 * Constant-wind calibration from aligned per-sample arrays: a Gauss-Newton fit on the un-squared
 * residual |Vg - W| - k u, seeded from zero wind with k0 = mean(|Vg| / u). Throws with fewer than
 * four samples. Upstream `calibrate`.
 */
export function calibrate(
  vn: ArrayLike<number>,
  ve: ArrayLike<number>,
  vd: ArrayLike<number>,
  u: ArrayLike<number>,
  opts: CalibrateOptions = {}
): ConstantWindFit {
  const spreadWarn = opts.courseSpreadWarnDeg ?? 10.0
  const stderrFracWarn = opts.ratioStderrFracWarn ?? 0.1
  const n = u.length
  if (n < 4) throw new Error(`need at least 4 samples to solve, got ${n}`)

  let k0sum = 0
  for (let i = 0; i < n; i++) k0sum += Math.sqrt(vn[i]! * vn[i]! + ve[i]! * ve[i]! + vd[i]! * vd[i]!) / u[i]!
  const rf = refine(vn, ve, vd, u, 0, 0, k0sum / n)
  const k = rf.k
  const m = k * k

  const varK = rf.cov[2]?.[2] ?? NaN
  const ratioStderr = isFinite(varK) ? 2.0 * k * Math.sqrt(varK) : NaN // d(k^2) = 2k dk

  const warnings: FitWarning[] = []
  if (!(k > 0)) warnings.push({ kind: 'nonPositiveRatio', ratio: m })

  const spread = courseSpreadDeg(vn, ve)
  const stderrFraction = isFinite(ratioStderr) && m > 0 ? ratioStderr / m : Infinity
  if (spread <= spreadWarn) warnings.push({ kind: 'littleCourseVariation', spreadDeg: spread })
  if (stderrFraction >= stderrFracWarn) warnings.push({ kind: 'weaklyDetermined', stderrFraction })

  return {
    ratio: m,
    k,
    ratioStderr,
    wind: [rf.windNorth, rf.windEast],
    residualRms: rf.residualRms,
    nSamples: n,
    courseSpreadDeg: spread,
    warnings
  }
}

// --- time-varying-wind smoother (alternating wind <-> scale) ---------------

/** Smoothed wind means and covariances per sample, as columns (upstream `{xs, Ps}`). */
export interface WindTrack {
  readonly north: Float64Array
  readonly east: Float64Array
  /** Covariance entries P[0][0], P[0][1], P[1][0], P[1][1]. */
  readonly pNN: Float64Array
  readonly pNE: Float64Array
  readonly pEN: Float64Array
  readonly pEE: Float64Array
}

/**
 * 2-state wind-only iterated EKF forward filter plus RTS smoother with the scale k held fixed.
 * The wind random-walks with process noise `qWind`; the scalar measurement per sample is
 * |Vg - W| - k u = 0, relinearised about the previous smoothed track `iters` times.
 * Upstream `wind_smoother`.
 */
export function windSmoother(
  dt: number,
  vn: ArrayLike<number>,
  ve: ArrayLike<number>,
  vd: ArrayLike<number>,
  u: ArrayLike<number>,
  k: number,
  qWind: number,
  rMeas: number,
  x0: NorthEast,
  p0: Matrix2,
  iters = 6
): WindTrack {
  const n = u.length
  if (n === 0) throw new Error('wind smoother needs at least one sample')
  const R = rMeas * rMeas
  const qd = qWind * qWind * dt
  const [x0n, x0e] = x0
  const [[p0nn, p0ne], [p0en, p0ee]] = p0

  // Linearisation point (upstream xbar) and smoothed output.
  const barN = new Float64Array(n).fill(x0n)
  const barE = new Float64Array(n).fill(x0e)
  const north = new Float64Array(n).fill(x0n)
  const east = new Float64Array(n).fill(x0e)
  const pNN = new Float64Array(n).fill(p0nn)
  const pNE = new Float64Array(n).fill(p0ne)
  const pEN = new Float64Array(n).fill(p0en)
  const pEE = new Float64Array(n).fill(p0ee)

  // Filtered (m_f, P_f) and predicted (m_p, P_p) moments.
  const fN = new Float64Array(n)
  const fE = new Float64Array(n)
  const f00 = new Float64Array(n)
  const f01 = new Float64Array(n)
  const f10 = new Float64Array(n)
  const f11 = new Float64Array(n)
  const pN = new Float64Array(n)
  const pE = new Float64Array(n)
  const p00 = new Float64Array(n)
  const p01 = new Float64Array(n)
  const p10 = new Float64Array(n)
  const p11 = new Float64Array(n)

  for (let iter = 0; iter < iters; iter++) {
    for (let t = 0; t < n; t++) {
      let mp0: number, mp1: number, P00: number, P01: number, P10: number, P11: number
      if (t === 0) {
        mp0 = x0n
        mp1 = x0e
        P00 = p0nn
        P01 = p0ne
        P10 = p0en
        P11 = p0ee
      } else {
        mp0 = fN[t - 1]! // F = I
        mp1 = fE[t - 1]!
        P00 = f00[t - 1]! + qd
        P01 = f01[t - 1]!
        P10 = f10[t - 1]!
        P11 = f11[t - 1]! + qd
      }
      pN[t] = mp0
      pE[t] = mp1
      p00[t] = P00
      p01[t] = P01
      p10[t] = P10
      p11[t] = P11

      const wb = barN[t]!
      const eb = barE[t]!
      let db = Math.sqrt((vn[t]! - wb) ** 2 + (ve[t]! - eb) ** 2 + vd[t]! ** 2)
      if (db <= 1e-6) db = 1e-6
      const h0 = -(vn[t]! - wb) / db
      const h1 = -(ve[t]! - eb) / db
      const hb = db - k * u[t]!
      // innovation about xbar, measurement z = 0
      const dm0 = mp0 - wb
      const dm1 = mp1 - eb
      const innov = -(hb + h0 * dm0 + h1 * dm1)
      // S = H Pp H^T + R
      const pph0 = P00 * h0 + P01 * h1
      const pph1 = P10 * h0 + P11 * h1
      const s = h0 * pph0 + h1 * pph1 + R
      const k0 = pph0 / s
      const k1 = pph1 / s
      fN[t] = mp0 + k0 * innov
      fE[t] = mp1 + k1 * innov
      // Joseph form: A = I - K H ; P_f = A Pp A^T + K K^T R
      const a00 = 1 - k0 * h0
      const a01 = -k0 * h1
      const a10 = -k1 * h0
      const a11 = 1 - k1 * h1
      const ap00 = a00 * P00 + a01 * P10
      const ap01 = a00 * P01 + a01 * P11
      const ap10 = a10 * P00 + a11 * P10
      const ap11 = a10 * P01 + a11 * P11
      f00[t] = ap00 * a00 + ap01 * a01 + k0 * k0 * R
      f01[t] = ap00 * a10 + ap01 * a11 + k0 * k1 * R
      f10[t] = ap10 * a00 + ap11 * a01 + k1 * k0 * R
      f11[t] = ap10 * a10 + ap11 * a11 + k1 * k1 * R
    }

    // RTS backward smoother (F = I)
    north[n - 1] = fN[n - 1]!
    east[n - 1] = fE[n - 1]!
    pNN[n - 1] = f00[n - 1]!
    pNE[n - 1] = f01[n - 1]!
    pEN[n - 1] = f10[n - 1]!
    pEE[n - 1] = f11[n - 1]!
    for (let t = n - 2; t >= 0; t--) {
      const n00 = p00[t + 1]!
      const n01 = p01[t + 1]!
      const n10 = p10[t + 1]!
      const n11 = p11[t + 1]!
      const det = n00 * n11 - n01 * n10
      const F00 = f00[t]!
      const F01 = f01[t]!
      const F10 = f10[t]!
      const F11 = f11[t]!
      if (Math.abs(det) < 1e-300) {
        north[t] = fN[t]!
        east[t] = fE[t]!
        pNN[t] = F00
        pNE[t] = F01
        pEN[t] = F10
        pEE[t] = F11
        continue
      }
      const i00 = n11 / det
      const i01 = -n01 / det
      const i10 = -n10 / det
      const i11 = n00 / det
      const c00 = F00 * i00 + F01 * i10
      const c01 = F00 * i01 + F01 * i11
      const c10 = F10 * i00 + F11 * i10
      const c11 = F10 * i01 + F11 * i11
      const dx0 = north[t + 1]! - pN[t + 1]!
      const dx1 = east[t + 1]! - pE[t + 1]!
      north[t] = fN[t]! + c00 * dx0 + c01 * dx1
      east[t] = fE[t]! + c10 * dx0 + c11 * dx1
      const d00 = pNN[t + 1]! - n00
      const d01 = pNE[t + 1]! - n01
      const d10 = pEN[t + 1]! - n10
      const d11 = pEE[t + 1]! - n11
      const cd00 = c00 * d00 + c01 * d10
      const cd01 = c00 * d01 + c01 * d11
      const cd10 = c10 * d00 + c11 * d10
      const cd11 = c10 * d01 + c11 * d11
      pNN[t] = cd00 * c00 + cd01 * c01 + F00
      pNE[t] = cd00 * c10 + cd01 * c11 + F01
      pEN[t] = cd10 * c00 + cd11 * c01 + F10
      pEE[t] = cd10 * c10 + cd11 * c11 + F11
    }

    barN.set(north)
    barE.set(east)
  }
  return { north, east, pNN, pNE, pEN, pEE }
}

/** One sensor's result from {@link calibrateCombined}. */
export interface SensorFit {
  /** Airspeed scale, sqrt(ARSPD_RATIO). */
  readonly k: number
  readonly ratio: number
  readonly ratioStderr: number
  readonly residualRms: number
  /** The sensor's ratio-1 true airspeed on the decimated grid. */
  readonly u: Float64Array
  /** Calibrated airspeed, k u. */
  readonly predicted: Float64Array
  /** Truth minus calibrated airspeed. */
  readonly residual: Float64Array
}

/** Result of the combined time-varying-wind fit (upstream `calibrate_combined`). */
export interface CombinedFit {
  /** Decimated sample times. */
  readonly t: Float64Array
  readonly windNorth: Float64Array
  readonly windEast: Float64Array
  readonly windSigmaNorth: Float64Array
  readonly windSigmaEast: Float64Array
  /** Largest distance of the wind from its mean over the window, m/s. */
  readonly windDrift: number
  readonly rMeas: number
  /** Alternating rounds used. */
  readonly iterations: number
  /** Shared truth airspeed |Vg - W| per sample. */
  readonly truth: Float64Array
  readonly sensors: readonly SensorFit[]
  readonly nSamples: number
}

export interface CombinedOptions {
  /** Decimation target rate (the wind is slow). Default 2 Hz. */
  readonly targetRateHz?: number
  readonly maxSamples?: number
  /** Inner smoother relinearisations. Default 5. */
  readonly iters?: number
  /** Alternating wind/scale rounds; at least 1. Default 6. */
  readonly maxOuter?: number
  readonly tol?: number
  /** Measurement noise, m/s. Default: mean seed residual, at least 0.3. */
  readonly rMeas?: number
  /** Wind process noise. Default {@link DEFAULT_Q_WIND}. */
  readonly qWind?: number
}

/**
 * Combined multi-sensor solve: a single wind model drives all airspeed sensors. The airspeed that
 * drives the wind is the equal-weight average of the sensors' calibrated true airspeeds; each
 * sensor keeps its own scale, re-solved by least squares against the common |Vg - W|. Wind and
 * scales alternate to convergence. `uList` holds each sensor's ratio-1 airspeed on the common
 * grid `t`; `seeds` are the per-sensor constant-wind fits. Upstream `calibrate_combined`.
 */
export function calibrateCombined(
  t: ArrayLike<number>,
  vn: ArrayLike<number>,
  ve: ArrayLike<number>,
  vd: ArrayLike<number>,
  uList: readonly ArrayLike<number>[],
  seeds: readonly ConstantWindFit[],
  opts: CombinedOptions = {}
): CombinedFit {
  const targetRateHz = opts.targetRateHz ?? 2.0
  const maxSamples = opts.maxSamples ?? 8000
  const windIters = opts.iters ?? 5
  const maxOuter = opts.maxOuter ?? 6
  const tol = opts.tol ?? 1e-4
  const S = uList.length

  // median dt + decimation (wind is slow)
  const n0 = t.length
  let dtFull = 1.0
  if (n0 > 1) {
    const diffs = new Float64Array(n0 - 1)
    for (let i = 1; i < n0; i++) diffs[i - 1] = t[i]! - t[i - 1]!
    diffs.sort()
    dtFull = diffs[diffs.length >> 1]!
  }
  if (!isFinite(dtFull) || dtFull <= 0) dtFull = 1.0
  let stride = Math.max(1, Math.round(1.0 / targetRateHz / dtFull))
  stride = Math.max(stride, Math.ceil(n0 / maxSamples))

  const n = Math.ceil(n0 / stride)
  const T = new Float64Array(n)
  const VN = new Float64Array(n)
  const VE = new Float64Array(n)
  const VD = new Float64Array(n)
  const US = uList.map(() => new Float64Array(n))
  for (let i = 0, j = 0; i < n0; i += stride, j++) {
    T[j] = t[i]!
    VN[j] = vn[i]!
    VE[j] = ve[i]!
    VD[j] = vd[i]!
    for (let s = 0; s < S; s++) US[s]![j] = uList[s]![i]!
  }
  const dt = dtFull * stride

  // measurement noise + wind seed from the per-sensor constant-wind solves
  let rsum = 0
  let wn0 = 0
  let we0 = 0
  for (const sd of seeds) {
    rsum += isFinite(sd.residualRms) ? sd.residualRms : 1.0
    wn0 += sd.wind[0]
    we0 += sd.wind[1]
  }
  const rMeas = opts.rMeas ?? Math.max(rsum / S, 0.3)
  const qWind = opts.qWind ?? DEFAULT_Q_WIND

  const x0: NorthEast = [wn0 / S, we0 / S]
  const P0: Matrix2 = [
    [25.0, 0],
    [0, 25.0]
  ]

  // Alternating: smooth the wind against the averaged airspeed, then re-solve every sensor's
  // scale against that wind.
  const k = seeds.map((sd) => (isFinite(sd.k) ? sd.k : 1.3))
  let track: WindTrack | undefined
  let iterations: number
  const avgTas = new Float64Array(n)
  for (iterations = 1; iterations <= maxOuter; iterations++) {
    for (let i = 0; i < n; i++) {
      let sTas = 0
      for (let s = 0; s < S; s++) sTas += k[s]! * US[s]![i]!
      avgTas[i] = sTas / S
    }
    // Wind smoother with the per-sample target airspeed avgTas: pass it as u with a unit scale
    // so the measurement is |Vg - W| - avgTas = 0.
    track = windSmoother(dt, VN, VE, VD, avgTas, 1.0, qWind, rMeas, x0, P0, windIters)
    let maxDelta = 0
    for (let s = 0; s < S; s++) {
      const us = US[s]!
      let num = 0
      let den = 0
      for (let i = 0; i < n; i++) {
        const dn = VN[i]! - track.north[i]!
        const de = VE[i]! - track.east[i]!
        const D = Math.sqrt(dn * dn + de * de + VD[i]! * VD[i]!)
        num += D * us[i]!
        den += us[i]! * us[i]!
      }
      const kNew = num / den
      maxDelta = Math.max(maxDelta, Math.abs(kNew - k[s]!))
      k[s] = kNew
    }
    if (maxDelta < tol) break
  }
  if (track === undefined) throw new Error('maxOuter must be at least 1')
  iterations = Math.min(iterations, maxOuter)

  // wind trajectory
  const windNorth = track.north
  const windEast = track.east
  const windSigmaNorth = new Float64Array(n)
  const windSigmaEast = new Float64Array(n)
  let mwn = 0
  let mwe = 0
  for (let i = 0; i < n; i++) {
    windSigmaNorth[i] = Math.sqrt(Math.max(track.pNN[i]!, 0))
    windSigmaEast[i] = Math.sqrt(Math.max(track.pEE[i]!, 0))
    mwn += windNorth[i]!
    mwe += windEast[i]!
  }
  mwn /= n
  mwe /= n
  let windDrift = 0
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(windNorth[i]! - mwn, windEast[i]! - mwe)
    if (d > windDrift) windDrift = d
  }

  // shared |Vg - W|
  const truth = new Float64Array(n)
  for (let i = 0; i < n; i++) truth[i] = Math.sqrt((VN[i]! - windNorth[i]!) ** 2 + (VE[i]! - windEast[i]!) ** 2 + VD[i]! ** 2)

  // per-sensor scale, residual, and plot series
  const sensors = US.map((us, s): SensorFit => {
    const ks = k[s] ?? NaN
    let rss = 0
    let den = 0
    const predicted = new Float64Array(n)
    const residual = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      predicted[i] = ks * us[i]!
      residual[i] = truth[i]! - predicted[i]!
      rss += residual[i]! * residual[i]!
      den += us[i]! * us[i]!
    }
    const dof = Math.max(n - 1, 1)
    const varK = rss / dof / den
    return {
      k: ks,
      ratio: ks * ks,
      ratioStderr: 2.0 * ks * Math.sqrt(varK),
      residualRms: Math.sqrt(rss / n),
      u: us,
      predicted,
      residual
    }
  })

  return {
    t: T,
    windNorth,
    windEast,
    windSigmaNorth,
    windSigmaEast,
    windDrift,
    rMeas,
    iterations,
    truth,
    sensors,
    nSamples: n
  }
}
