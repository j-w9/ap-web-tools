/**
 * The fit pipeline over a loaded log: resample every stream onto one grid, seed each sensor with a
 * constant-wind fit, then run the combined time-varying-wind fit (upstream `build_combined`,
 * `calculate`, `run_wind_model` and `sensor_series`).
 */
import { linearInterp } from '@apwt/signal'
import {
  airTemperatureC,
  calibrate,
  calibrateCombined,
  eas2tas,
  fitWarningText,
  type CombinedFit,
  type ConstantWindFit
} from './core.js'
import type { AirspeedLog, AirspeedSensor, VelocitySource } from './load.js'

/** Index of the last sample before `start` (upstream `find_start_index`). */
export function windowStartIndex(time: ArrayLike<number>, start: number): number {
  let index = 0
  for (let j = 0; j < time.length; j++) {
    if (time[j]! < start) index = j
  }
  return index
}

/** Index one past the last sample at or before `end` (upstream `find_end_index`). */
export function windowEndIndex(time: ArrayLike<number>, end: number): number {
  let index = 0
  for (let j = 0; j < time.length - 1; j++) {
    if (time[j]! <= end) index = j + 1
  }
  return index
}

/** Every stream on one common time grid, keeping only samples where all sensors read positive. */
export interface CombinedSamples {
  readonly t: Float64Array
  readonly vn: Float64Array
  readonly ve: Float64Array
  readonly vd: Float64Array
  /** Each sensor's ratio-1 true airspeed, sqrt(dpress) * EAS2TAS. */
  readonly uList: readonly Float64Array[]
  /** Onboard EKF wind on the grid, when the velocity source logged it. */
  readonly ekfWind: { readonly north: Float64Array; readonly east: Float64Array } | null
}

/**
 * Build per-sample arrays on the first sensor's timestamps over the window; every other stream is
 * interpolated onto them. Air temperature for EAS2TAS is the ground temperature lapsed over the
 * height above home. Upstream `build_combined`.
 */
export function buildCombined(
  log: Pick<AirspeedLog, 'baro' | 'pos'>,
  sensors: readonly [AirspeedSensor, ...AirspeedSensor[]],
  source: VelocitySource,
  groundTempC: number,
  window: readonly [number, number]
): CombinedSamples {
  const ref = sensors[0]
  const startIndex = windowStartIndex(ref.time, window[0])
  const endIndex = windowEndIndex(ref.time, window[1]) + 1
  const ct = ref.time.slice(startIndex, endIndex)

  const vn = linearInterp(source.vn, source.time, ct)
  const ve = linearInterp(source.ve, source.time, ct)
  const vd = linearInterp(source.vd, source.time, ct)
  const staticPress = linearInterp(log.baro.press, log.baro.time, ct)
  const relAlt = linearInterp(log.pos.relAlt, log.pos.time, ct)
  const ekfN = source.wind ? linearInterp(source.wind.north, source.wind.time, ct) : null
  const ekfE = source.wind ? linearInterp(source.wind.east, source.wind.time, ct) : null
  const dp = sensors.map((s) => linearInterp(s.dpress, s.time, ct))
  const S = sensors.length

  const keep: number[] = []
  const uRows: Float64Array[] = []
  const us = new Float64Array(S)
  for (let i = 0; i < ct.length; i++) {
    const tempC = airTemperatureC(groundTempC, relAlt[i]!)
    const e2t = eas2tas(staticPress[i]!, tempC)
    let ok = true
    for (let s = 0; s < S; s++) {
      const d = dp[s]![i]!
      us[s] = Math.sqrt(Math.max(d, 0)) * e2t
      if (!(d > 0)) ok = false
    }
    if (!ok) continue
    keep.push(i)
    uRows.push(us.slice())
  }

  const pick = (a: Float64Array): Float64Array => Float64Array.from(keep, (i) => a[i]!)
  return {
    t: pick(ct),
    vn: pick(vn),
    ve: pick(ve),
    vd: pick(vd),
    uList: sensors.map((_, s) => Float64Array.from(uRows, (row) => row[s]!)),
    ekfWind: ekfN && ekfE ? { north: pick(ekfN), east: pick(ekfE) } : null
  }
}

/** What the fit is run with; results are shown only while the form still matches these. */
export interface FitInputs {
  /** Name of the velocity source. */
  readonly source: string
  readonly groundTempC: number
  /** Analysis window, s. */
  readonly window: readonly [number, number]
}

export function sameFitInputs(a: FitInputs, b: FitInputs): boolean {
  return a.source === b.source && a.groundTempC === b.groundTempC && a.window[0] === b.window[0] && a.window[1] === b.window[1]
}

/** Minimum kept samples for a fit. */
export const MIN_FIT_SAMPLES = 4

/** Resampled data and per-sensor constant-wind seeds; the wind model is run from this. */
export type PreparedFit =
  | { readonly kind: 'insufficient'; readonly combined: CombinedSamples }
  | { readonly kind: 'ready'; readonly combined: CombinedSamples; readonly seeds: readonly ConstantWindFit[] }

/** Resample and seed (upstream `calculate` up to `run_wind_model`). */
export function prepareFit(log: AirspeedLog, inputs: FitInputs): PreparedFit {
  const source = log.sources.find((s) => s.name === inputs.source)
  if (source === undefined) throw new Error(`Unknown velocity source ${inputs.source}`)
  const combined = buildCombined(log, log.sensors, source, inputs.groundTempC, inputs.window)
  if (combined.t.length < MIN_FIT_SAMPLES) return { kind: 'insufficient', combined }
  const seeds = combined.uList.map((u) => calibrate(combined.vn, combined.ve, combined.vd, u))
  return { kind: 'ready', combined, seeds }
}

/** Run the combined wind model with process noise `qWind` (upstream `run_wind_model`). */
export function runWindModel(prepared: PreparedFit, qWind: number): CombinedFit | null {
  if (prepared.kind === 'insufficient') return null
  const c = prepared.combined
  return calibrateCombined(c.t, c.vn, c.ve, c.vd, c.uList, prepared.seeds, { qWind })
}

/** Wind process noise from the slider position, which is log10(q) (upstream `slider_to_q`). */
export function sliderToQ(position: number): number {
  return Math.pow(10, position)
}

/** Slider limits and default, as upstream's range input. */
export const Q_SLIDER = { min: -3, max: 0, step: 0.05, initial: -1.5 } as const

/** The q readout text and hint (upstream `update_q_readout`). */
export function qReadout(q: number): { text: string; hint: string } {
  const text = q.toFixed(q < 0.01 ? 4 : q < 0.1 ? 3 : 2)
  const hint = q <= 0.002 ? '≈ constant wind' : q >= 0.3 ? 'wind free to drift fast' : ''
  return { text, hint }
}

/** Error statistics of one calibrated airspeed series against the truth. */
export interface SeriesStats {
  readonly predicted: Float64Array
  readonly residual: Float64Array
  readonly rms: number
  readonly mean: number
}

/** A sensor's airspeed with the fitted ratio and, when the log has a usable ratio, the current one. */
export interface SensorSeries {
  readonly after: SeriesStats
  readonly before: SeriesStats | null
}

function mean(a: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]!
  return s / a.length
}

/**
 * Before/after series for sensor `index` against the shared truth: "before" uses the ratio in the
 * log, "after" the fitted ratio, so they differ only by the scale. Upstream `sensor_series`.
 */
export function sensorSeries(model: CombinedFit, index: number, currentRatio: number | undefined): SensorSeries | null {
  const ps = model.sensors[index]
  if (ps === undefined) return null
  const D = model.truth
  const n = D.length
  const after: SeriesStats = { predicted: ps.predicted, residual: ps.residual, rms: ps.residualRms, mean: mean(ps.residual) }
  if (currentRatio === undefined || !isFinite(currentRatio) || !(currentRatio > 0)) return { after, before: null }
  const kb = Math.sqrt(currentRatio)
  const predicted = new Float64Array(n)
  const residual = new Float64Array(n)
  let s2 = 0
  for (let m = 0; m < n; m++) {
    predicted[m] = kb * ps.u[m]!
    residual[m] = D[m]! - predicted[m]!
    s2 += residual[m]! * residual[m]!
  }
  return { after, before: { predicted, residual, rms: Math.sqrt(s2 / n), mean: mean(residual) } }
}

/** The fitted ratio of sensor `index` when finite (upstream `sensor_ratio`). */
export function fittedRatio(model: CombinedFit | null, index: number): number | null {
  const r = model?.sensors[index]?.ratio
  return r !== undefined && isFinite(r) ? r : null
}

/** Reliability warnings of the seeds, deduplicated by text in sensor order (upstream `render_param_rows`). */
export function seedWarnings(prepared: PreparedFit): string[] {
  if (prepared.kind === 'insufficient') return []
  return [...new Set(prepared.seeds.flatMap((s) => s.warnings.map(fitWarningText)))]
}

/** Horizontal ground speed of a velocity source, for the flight data plot. */
export function groundSpeed(source: VelocitySource): Float64Array {
  return Float64Array.from({ length: source.time.length }, (_, i) => Math.hypot(source.vn[i]!, source.ve[i]!))
}

/** The onboard EKF wind on the wind model's decimated grid, or null when not logged (upstream `redraw_wind_model`). */
export function ekfWindOnFit(
  combined: CombinedSamples,
  model: CombinedFit
): { readonly north: Float64Array; readonly east: Float64Array } | null {
  if (combined.ekfWind === null) return null
  return {
    north: linearInterp(combined.ekfWind.north, combined.t, model.t),
    east: linearInterp(combined.ekfWind.east, combined.t, model.t)
  }
}
