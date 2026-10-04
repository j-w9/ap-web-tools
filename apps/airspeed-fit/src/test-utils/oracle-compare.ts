// Test-only: comparisons of upstream AirspeedFit state (after `load`/`calculate`, run by
// upstream.ts) with the port. Shared by the oracle tests and the real-log test.
import { expect } from 'vitest'
import { fitWarningText, type CombinedFit } from '../analysis/core.js'
import {
  prepareFit,
  runWindModel,
  seedWarnings,
  sensorSeries,
  sliderToQ,
  type FitInputs,
  type PreparedFit
} from '../analysis/fit.js'
import type { AirspeedLog } from '../analysis/load.js'
import { temperatureReadout } from '../analysis/temperature.js'
import { expectSameArray, expectSameNumber } from './compare.js'
import type { UpCal, UpCombined, UpstreamTool } from './upstream.js'

export interface UpSensor {
  instance: number
  time: number[]
  dpress: number[]
  asp_reported: number[]
  ratio_name: string
  current_ratio: number | undefined
  use: number | undefined
  devid: number | undefined
  seed: UpCal | null
}
export interface UpCombinedSamples {
  t: number[]
  vn: number[]
  ve: number[]
  vd: number[]
  u_list: number[][]
  wind_n: number[] | null
  wind_e: number[] | null
}

export function numberValue(up: UpstreamTool, id: string): number {
  return parseFloat(String(up.element(id)['value']))
}

/** Run the port the way the app does for the inputs upstream currently has in its form. */
export function portCalculate(
  log: AirspeedLog,
  up: UpstreamTool
): { prepared: PreparedFit; model: CombinedFit | null; inputs: FitInputs } {
  const inputs: FitInputs = {
    source: log.sources[0].name,
    groundTempC: numberValue(up, 'ground_temp'),
    window: [numberValue(up, 'TimeStart'), numberValue(up, 'TimeEnd')]
  }
  const prepared = prepareFit(log, inputs)
  return { prepared, model: runWindModel(prepared, sliderToQ(numberValue(up, 'q_slider'))), inputs }
}

export function compareFit(
  up: UpstreamTool,
  log: AirspeedLog,
  prepared: PreparedFit,
  model: CombinedFit | null,
  label: string
): void {
  const combined = up.evaluate('combined') as UpCombinedSamples
  const c = prepared.combined
  expectSameArray(c.t, combined.t, `${label} t`)
  expectSameArray(c.vn, combined.vn, `${label} vn`)
  expectSameArray(c.ve, combined.ve, `${label} ve`)
  expectSameArray(c.vd, combined.vd, `${label} vd`)
  c.uList.forEach((u, s) => expectSameArray(u, combined.u_list[s], `${label} u${s}`))
  expectSameArray(c.ekfWind?.north, combined.wind_n ?? undefined, `${label} ekf n`)
  expectSameArray(c.ekfWind?.east, combined.wind_e ?? undefined, `${label} ekf e`)

  const sensors = up.evaluate('ASP_Data') as UpSensor[]
  expect(prepared.kind).toBe('ready')
  if (prepared.kind !== 'ready') return
  prepared.seeds.forEach((seed, s) => {
    const o = sensors[s]!.seed!
    expectSameNumber(seed.ratio, o.ratio, `${label} seed ratio ${s}`)
    expectSameArray(seed.wind, o.wind_ne, `${label} seed wind ${s}`)
    expectSameNumber(seed.ratioStderr, o.ratio_stderr, `${label} seed stderr ${s}`)
    expect(seed.warnings.map(fitWarningText)).toEqual(o.warnings)
  })

  const fit = up.evaluate('fit_result') as UpCombined
  expect(model).not.toBeNull()
  if (model === null) return
  expectSameArray(model.t, fit.t, `${label} fit t`)
  expectSameArray(model.truth, fit.D, `${label} D`)
  expectSameArray(
    model.windNorth,
    fit.wind_ne.map((w) => w[0]),
    `${label} wind n`
  )
  expectSameArray(
    model.windSigmaEast,
    fit.wind_sigma.map((w) => w[1]),
    `${label} sigma e`
  )
  expectSameNumber(model.windDrift, fit.wind_drift, `${label} drift`)
  model.sensors.forEach((s, i) => {
    expectSameNumber(s.ratio, fit.per_sensor[i]!.ratio, `${label} ratio ${i}`)
    expectSameArray(s.residual, fit.per_sensor[i]!.resid, `${label} resid ${i}`)
  })

  // Before/after series (upstream sensor_series).
  log.sensors.forEach((sensor, i) => {
    const mine = sensorSeries(model, i, sensor.currentRatio)
    const theirs = up.evaluate(`sensor_series(${i})`) as {
      pred_before: number[] | null
      resid_before: number[] | null
      rms_before: number | null
      mean_before: number | null
      rms_after: number
      mean_after: number
    }
    expectSameArray(mine?.before?.predicted, theirs.pred_before ?? undefined, `${label} before ${i}`)
    expectSameArray(mine?.before?.residual, theirs.resid_before ?? undefined, `${label} resid before ${i}`)
    expectSameNumber(mine?.before?.rms ?? NaN, theirs.rms_before, `${label} rms before ${i}`)
    expectSameNumber(mine?.before?.mean ?? NaN, theirs.mean_before, `${label} mean before ${i}`)
    expectSameNumber(mine?.after.rms ?? NaN, theirs.rms_after, `${label} rms after ${i}`)
    expectSameNumber(mine?.after.mean ?? NaN, theirs.mean_after, `${label} mean after ${i}`)
  })

  // Deduplicated warnings, shown under the parameters.
  const warningHtml = String(up.element('param_warning')['innerHTML'])
  const theirWarnings =
    warningHtml === '' ? [] : warningHtml.split('<br>').map((w) => w.replace("<span class='warn'>⚠ ", '').replace('</span>', ''))
  expect(seedWarnings(prepared)).toEqual(theirWarnings)
}

export function readoutText(log: AirspeedLog, inputs: FitInputs): string {
  const r = temperatureReadout(log, inputs.groundTempC, inputs.window)
  const pct = r.eas2tasPercent
  return (
    'Field elevation: ' +
    (r.fieldElevationM !== null ? r.fieldElevationM.toFixed(0) + ' m' : 'n/a') +
    '<br>Density altitude: ' +
    (r.densityAltitudeM !== null ? r.densityAltitudeM.toFixed(0) + ' m' : 'n/a') +
    '<br>Avg EAS2TAS: ' +
    (pct !== null ? (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%' : 'n/a')
  )
}

/** Compare what upstream `load` read from the log (sensors, sources and log facts) with the port. */
export function compareLoad(up: UpstreamTool, log: AirspeedLog): void {
  const sensors = up.evaluate('ASP_Data') as UpSensor[]
  expect(log.sensors.map((s) => s.instance)).toEqual(sensors.map((s) => s.instance))
  log.sensors.forEach((s, i) => {
    const o = sensors[i]!
    expectSameArray(s.time, o.time, `time ${i}`)
    expectSameArray(s.dpress, o.dpress, `dpress ${i}`)
    expectSameArray(s.airspeed, o.asp_reported, `airspeed ${i}`)
    expect(s.ratioName).toBe(o.ratio_name)
    expect(s.currentRatio).toBe(o.current_ratio)
    expect(s.use).toBe(o.use)
    expect(s.devId).toBe(o.devid)
  })
  const data = up.evaluate('log_data') as {
    sources: { name: string }[]
    flight_lo: number | null
    flight_hi: number | null
    field_elevation: number | null
    field_time: number | null
    takeoff: { lat: number; lng: number; date: Date } | null
    temp_sources: Record<string, { value: number }>
    start_time: number
    end_time: number
  }
  expect(log.sources.map((s) => s.name)).toEqual(data.sources.map((s) => s.name))
  expect(log.flight).toEqual(data.flight_lo === null ? null : { lo: data.flight_lo, hi: data.flight_hi })
  expect(log.field).toEqual(data.field_elevation === null ? null : { elevation: data.field_elevation, time: data.field_time })
  expect(log.takeoff?.lat).toBe(data.takeoff?.lat)
  expect(log.takeoff?.lng).toBe(data.takeoff?.lng)
  expect(log.takeoff?.date.getTime()).toBe(data.takeoff?.date.getTime())
  expect(log.tempSources).toEqual(Object.fromEntries(Object.entries(data.temp_sources).map(([k, v]) => [k, v.value])))
  expect(log.startTime).toBe(data.start_time)
  expect(log.endTime).toBe(data.end_time)
  expect(log.autoWindow).toEqual([numberValue(up, 'TimeStart'), numberValue(up, 'TimeEnd')])
}
