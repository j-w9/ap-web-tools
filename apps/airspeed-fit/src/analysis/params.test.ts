import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { decodeAirspeedDevId } from './devid.js'
import { paramFileText, paramToString, ratioSuggestions, outOfRangeText } from './params.js'
import type { CombinedFit } from './core.js'
import type { AirspeedSensor } from './load.js'

const upstream = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../upstream/Libraries')
const context = createContext({ console })
runInContext(readFileSync(resolve(upstream, 'Param_Helpers.js'), 'utf8'), context)
runInContext(readFileSync(resolve(upstream, 'DecodeDevID.js'), 'utf8'), context)
const upParamToString = runInContext('param_to_string', context) as (v: number) => string
const upDecode = runInContext('(id) => decode_devid(id, DEVICE_TYPE_AIRSPEED)', context) as (
  id: number
) => Record<string, unknown>

describe('paramToString', () => {
  it('matches upstream', () => {
    for (const v of [0, 1, 1.987, 2.0, 1.2345678, 0.1, -3.25, 1e-7, 123456.7]) expect(paramToString(v)).toBe(upParamToString(v))
  })
})

describe('decodeAirspeedDevId', () => {
  it('matches upstream decode_devid', () => {
    for (const id of [
      1 | (0x28 << 8) | (2 << 16),
      3 | (1 << 3) | (12 << 8),
      3 | (12 << 8) | (3 << 16),
      2 | (0x0b << 16),
      0x7f0000 | 4
    ]) {
      const mine = decodeAirspeedDevId(id)
      const theirs = upDecode(id)
      expect(mine.name).toBe(theirs['name'])
      expect(mine.busType).toBe(theirs['bus_type'])
      expect(mine.bus).toBe(theirs['bus'])
      expect(mine.address).toBe(theirs['address'])
      if (mine.dronecan) expect(mine.sensorId).toBe(theirs['sensor_id'])
      else expect(mine.devtype).toBe(theirs['devtype'])
    }
  })
})

describe('parameter file', () => {
  const sensor = (instance: number, currentRatio: number | undefined): AirspeedSensor => ({
    instance,
    time: new Float64Array(),
    dpress: new Float32Array(),
    airspeed: new Float32Array(),
    ratioName: instance === 0 ? 'ARSPD_RATIO' : `ARSPD${instance + 1}_RATIO`,
    useName: instance === 0 ? 'ARSPD_USE' : `ARSPD${instance + 1}_USE`,
    currentRatio,
    use: 1,
    devId: undefined,
    healthy: true,
    primary: instance === 0
  })
  const model = (ratios: number[]): CombinedFit => ({
    t: new Float64Array(),
    windNorth: new Float64Array(),
    windEast: new Float64Array(),
    windSigmaNorth: new Float64Array(),
    windSigmaEast: new Float64Array(),
    windDrift: 0,
    rMeas: 0,
    iterations: 1,
    truth: new Float64Array(),
    nSamples: 0,
    sensors: ratios.map((ratio) => ({
      k: Math.sqrt(ratio),
      ratio,
      ratioStderr: 0,
      residualRms: 0,
      u: new Float64Array(),
      predicted: new Float64Array(),
      residual: new Float64Array()
    }))
  })

  it('rounds to three decimals and flags atypical ratios', () => {
    const s = ratioSuggestions([sensor(0, 2), sensor(1, undefined), sensor(2, 2)], model([2.12345, 3.4567, NaN]))
    expect(s[0]).toMatchObject({ name: 'ARSPD_RATIO', ratio: 2.123, outOfRange: false })
    expect(s[0]?.changePercent).toBeCloseTo(6.1725, 9)
    expect(s[1]).toMatchObject({ name: 'ARSPD2_RATIO', ratio: 3.457, outOfRange: true, changePercent: null })
    expect(s[2]).toBeNull()
    expect(paramFileText(s)).toBe('ARSPD_RATIO,2.123\nARSPD2_RATIO,3.457\n')
    expect(s[1] && outOfRangeText(s[1])).toBe('ARSPD2_RATIO = 3.457 outside typical range 1 to 3')
  })

  it('has no suggestions without a model', () => {
    expect(ratioSuggestions([sensor(0, 2)], null)).toEqual([null])
  })
})
