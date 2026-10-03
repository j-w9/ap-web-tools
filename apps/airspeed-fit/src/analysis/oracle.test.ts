/**
 * End-to-end oracle: run upstream AirspeedFit (airspeedfit.js in a vm with a stub DOM and the
 * upstream parser) and the port on the same synthetic plane log and require identical results at
 * every stage: loading, resampling, seeds, wind model, readout, suggested parameters and file.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { expectSameArray, expectSameNumber } from '../test-utils/compare.js'
import { buildSyntheticAirspeedLog } from '../test-utils/synthetic-log.js'
import { createUpstreamTool, upstreamLoad, type UpCal, type UpCombined, type UpstreamTool } from '../test-utils/upstream.js'
import { fitWarningText, type CombinedFit } from './core.js'
import { prepareFit, runWindModel, seedWarnings, sensorSeries, sliderToQ, type FitInputs, type PreparedFit } from './fit.js'
import { loadAirspeedLog, type AirspeedLog } from './load.js'
import { paramFileText, ratioSuggestions } from './params.js'
import { chooseTempSource, tempBoxText, temperatureReadout } from './temperature.js'

interface UpSensor {
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
interface UpCombinedSamples {
  t: number[]
  vn: number[]
  ve: number[]
  vd: number[]
  u_list: number[][]
  wind_n: number[] | null
  wind_e: number[] | null
}

function numberValue(up: UpstreamTool, id: string): number {
  return parseFloat(String(up.element(id)['value']))
}

/** Run the port the way the app does for the inputs upstream currently has in its form. */
function portCalculate(
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

function compareFit(up: UpstreamTool, log: AirspeedLog, prepared: PreparedFit, model: CombinedFit | null, label: string): void {
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

function readoutText(log: AirspeedLog, inputs: FitInputs): string {
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

describe('AirspeedFit end to end against upstream', () => {
  const buffer = buildSyntheticAirspeedLog()
  let up: UpstreamTool
  let log: AirspeedLog

  beforeAll(async () => {
    up = await createUpstreamTool()
    await upstreamLoad(up, buffer)
    await new Promise((r) => setTimeout(r, 0)) // let the failed weather lookup settle
    log = loadAirspeedLog(DataflashLog.parse(buffer))
  }, 60_000)

  it('loads the same sensors, sources and log facts', () => {
    expect(up.alerts).toEqual([])
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
      flight_lo: number
      flight_hi: number
      field_elevation: number
      field_time: number
      takeoff: { lat: number; lng: number; date: Date }
      temp_sources: Record<string, { value: number }>
      start_time: number
      end_time: number
    }
    expect(log.sources.map((s) => s.name)).toEqual(data.sources.map((s) => s.name))
    expect(log.flight).toEqual({ lo: data.flight_lo, hi: data.flight_hi })
    expect(log.field).toEqual({ elevation: data.field_elevation, time: data.field_time })
    expect(log.takeoff?.lat).toBe(data.takeoff.lat)
    expect(log.takeoff?.lng).toBe(data.takeoff.lng)
    expect(log.takeoff?.date.getTime()).toBe(data.takeoff.date.getTime())
    expect(log.tempSources).toEqual(Object.fromEntries(Object.entries(data.temp_sources).map(([k, v]) => [k, v.value])))
    expect(log.startTime).toBe(data.start_time)
    expect(log.endTime).toBe(data.end_time)
    expect(log.autoWindow).toEqual([numberValue(up, 'TimeStart'), numberValue(up, 'TimeEnd')])
    // Default temperature: ISA, rounded into the box.
    const choice = chooseTempSource(log.tempSources, 'isa')
    expect(choice).toBe('isa')
    expect(tempBoxText(log.tempSources.isa ?? NaN)).toBe(up.element('ground_temp')['value'])
  })

  it('fits identically after load', () => {
    const { prepared, model, inputs } = portCalculate(log, up)
    compareFit(up, log, prepared, model, 'load')
    expect(readoutText(log, inputs)).toBe(up.element('temp_debug')['innerHTML'])
  })

  it('fits identically after changing window, temperature, source and q', () => {
    up.element('TimeStart')['value'] = '150'
    up.element('TimeEnd')['value'] = '480'
    up.element('ground_temp')['value'] = '23'
    up.element('q_slider')['value'] = '-0.5'
    up.evaluate('calculate()')
    const { prepared, model, inputs } = portCalculate(log, up)
    compareFit(up, log, prepared, model, 'edited')
    expect(readoutText(log, inputs)).toBe(up.element('temp_debug')['innerHTML'])

    // Second EKF core.
    up.evaluate('log_data.sources[0].select.checked = false; log_data.sources[1].select.checked = true; calculate()')
    const other = prepareFit(log, { ...inputs, source: log.sources[1]?.name ?? '' })
    compareFit(up, log, other, runWindModel(other, sliderToQ(-0.5)), 'core 1')
  })

  it('writes the same parameter file', () => {
    up.evaluate('save_parameters()')
    const { model } = portCalculate(log, up)
    const suggestions = ratioSuggestions(log.sensors, model)
    expect(paramFileText(suggestions)).toBe(up.saved.at(-1))
    expect(suggestions.every((s) => s && !s.outOfRange)).toBe(true)
  })

  it('reports an empty window the way upstream does', () => {
    up.element('TimeStart')['value'] = '5'
    up.element('TimeEnd')['value'] = '5'
    up.evaluate('calculate()')
    const { prepared, model } = portCalculate(log, up)
    expect(prepared.kind).toBe('insufficient')
    expect(model).toBeNull()
    expect(up.evaluate('fit_result')).toBeNull()
    expect(ratioSuggestions(log.sensors, model)).toEqual([null, null])
  })
})

describe('Open-Meteo source against upstream', () => {
  it('selects the weather temperature and refits like upstream', async () => {
    const buffer = buildSyntheticAirspeedLog({ flightSeconds: 300 })
    const log = loadAirspeedLog(DataflashLog.parse(buffer))
    const date = log.takeoff?.date ?? new Date(0)
    const hour = new Date(Math.floor(date.getTime() / 3600000) * 3600000)
    const iso = (d: Date) => d.toISOString().slice(0, 16)
    const weather = {
      hourly: {
        time: [iso(new Date(hour.getTime() - 3600000)), iso(hour), iso(new Date(hour.getTime() + 3600000))],
        temperature_2m: [3.4, 7.6, 11.2]
      }
    }
    const up = await createUpstreamTool(weather)
    await upstreamLoad(up, buffer)
    await new Promise((r) => setTimeout(r, 10))
    expect(up.fetched).toHaveLength(1)
    const { openMeteoUrl, nearestHourTemperature } = await import('./weather.js')
    // The URL depends on "now"; compare the location/time parts that do not.
    expect(up.fetched[0]).toContain(
      openMeteoUrl(log.takeoff!.lat, log.takeoff!.lng, date, Date.now()).split('&past_days')[0]!.split('&start_date')[0]!
    )
    const oat = nearestHourTemperature(weather, date)
    expect(up.evaluate('log_data.temp_sources.openmeteo.value')).toBe(oat)
    const sources = { ...log.tempSources, openmeteo: oat ?? NaN }
    expect(chooseTempSource(sources, 'openmeteo')).toBe('openmeteo')
    expect(up.element('ground_temp')['value']).toBe(tempBoxText(oat ?? NaN))
    const { prepared, model } = portCalculate(log, up)
    compareFit(up, log, prepared, model, 'open-meteo')
  }, 60_000)
})
