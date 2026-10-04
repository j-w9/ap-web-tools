/**
 * End-to-end oracle: run upstream AirspeedFit (airspeedfit.js in a vm with a stub DOM and the
 * upstream parser) and the port on the same synthetic plane log and require identical results at
 * every stage: loading, resampling, seeds, wind model, readout, suggested parameters and file.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { compareFit, compareLoad, portCalculate, readoutText, type UpCombinedSamples } from '../test-utils/oracle-compare.js'
import { buildSyntheticAirspeedLog } from '../test-utils/synthetic-log.js'
import { createUpstreamTool, upstreamLoad, type UpstreamTool } from '../test-utils/upstream.js'
import { expectSameArray } from '../test-utils/compare.js'
import { prepareFit, runWindModel, sliderToQ } from './fit.js'
import { loadAirspeedLog, type AirspeedLog } from './load.js'
import { paramFileText, planSave, ratioSuggestions } from './params.js'
import { chooseTempSource, tempBoxText } from './temperature.js'

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
    compareLoad(up, log)
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
    const plan = planSave(suggestions)
    expect(plan.kind === 'save' && plan.summary).toBe(up.alerts.at(-1))
    expect(plan.kind === 'save' && plan.confirm).toBeNull()
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
    up.alerts.length = 0
    up.evaluate('save_parameters()')
    const plan = planSave(ratioSuggestions(log.sensors, model))
    expect(plan.kind === 'nothing' && plan.message).toBe(up.alerts[0])
  })

  it.each([
    ['empty inputs', '', ''],
    ['empty start', '', '300'],
    ['empty end', '200', ''],
    ['end before start', '400', '200'],
    ['fractional window', '123.4', '377.9']
  ])('builds the same samples for odd window inputs: %s', (_label, start, end) => {
    up.evaluate('log_data.sources[1].select.checked = false; log_data.sources[0].select.checked = true')
    up.element('TimeStart')['value'] = start
    up.element('TimeEnd')['value'] = end
    up.evaluate('calculate()')
    const { prepared, model, inputs } = portCalculate(log, up)
    const combined = up.evaluate('combined') as UpCombinedSamples
    expectSameArray(prepared.combined.t, combined.t, 't')
    if (prepared.kind === 'ready') compareFit(up, log, prepared, model, _label)
    else expect(up.evaluate('fit_result')).toBeNull()
    expect(readoutText(log, inputs)).toBe(up.element('temp_debug')['innerHTML'])
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

describe('AirspeedFit saving and load failures against upstream', () => {
  it('asks the same confirmation for an out-of-range ratio and writes the same file', async () => {
    const buffer = buildSyntheticAirspeedLog({ trueRatios: [3.6, 2.2], flightSeconds: 300 })
    const up = await createUpstreamTool()
    await upstreamLoad(up, buffer)
    await new Promise((r) => setTimeout(r, 0))
    const log = loadAirspeedLog(DataflashLog.parse(buffer))
    const { model } = portCalculate(log, up)
    up.alerts.length = 0
    up.evaluate('save_parameters()')
    const plan = planSave(ratioSuggestions(log.sensors, model))
    expect(plan.kind).toBe('save')
    if (plan.kind !== 'save') return
    expect(plan.confirm).toBe(up.confirms[0])
    expect(plan.text).toBe(up.saved[0])
    expect(plan.summary).toBe(up.alerts[0])
  }, 60_000)

  it('reads a BARO message without instances as one barometer (upstream crashes: proven bug, fixed)', async () => {
    // docs/bug-proofs/airspeed-fit.md row 1, proofs/airspeed-fit/load-crashes.test.ts.
    const buffer = buildSyntheticAirspeedLog({ flightSeconds: 120, baroNoInstance: true })
    const upFails = await createUpstreamTool()
    await expect(upstreamLoad(upFails, buffer)).rejects.toThrow("Cannot use 'in' operator to search for '0' in undefined")
    // Corrected: the same records as instance 0, which upstream loads and fits.
    const withInstance = buildSyntheticAirspeedLog({ flightSeconds: 120 })
    const up = await createUpstreamTool()
    await upstreamLoad(up, withInstance)
    await new Promise((r) => setTimeout(r, 0))
    const log = loadAirspeedLog(DataflashLog.parse(buffer))
    expect(log.baro.time.length).toBeGreaterThan(0)
    expect(log.baro).toEqual(loadAirspeedLog(DataflashLog.parse(withInstance)).baro)
    // Upstream offers no BARO.GndTemp preset for an un-instanced BARO (baro_gnd_temp_at); nor does the port.
    expect(log.tempSources.baro).toBeUndefined()
    const { prepared, model } = portCalculate(log, up)
    compareFit(up, log, prepared, model, 'baro without instance')
  }, 60_000)

  it.each([
    ['XKF1 without velocity columns', { xkfNoVelocity: true }, 'undefined is not iterable', 'XKF1 is missing VN, VE or VD'],
    [
      'STAT without isFlying',
      { statNoFlying: true },
      "Cannot read properties of undefined (reading 'length')",
      'STAT is missing TimeUS or isFlying'
    ]
  ])(
    'stops with a message on %s (upstream crashes: proven bug, no port change)',
    async (_label, options, theirs, mine) => {
      // docs/bug-proofs/airspeed-fit.md row 1: upstream throws with no alert; the port already
      // stops the load with a user-facing message, the minimal correct behaviour.
      const buffer = buildSyntheticAirspeedLog({ flightSeconds: 120, ...options })
      const up = await createUpstreamTool()
      await expect(upstreamLoad(up, buffer)).rejects.toThrow(theirs)
      expect(up.alerts).toEqual([])
      expect(() => loadAirspeedLog(DataflashLog.parse(buffer))).toThrow(mine)
    },
    60_000
  )

  it('zooms the flight data plot to the exact auto window like upstream', async () => {
    const buffer = buildSyntheticAirspeedLog({ flightSeconds: 300 })
    const up = await createUpstreamTool()
    await upstreamLoad(up, buffer)
    const log = loadAirspeedLog(DataflashLog.parse(buffer))
    expect([...log.autoWindowExact]).toEqual(up.evaluate('flight_data.layout.xaxis.range'))
  }, 60_000)
})
