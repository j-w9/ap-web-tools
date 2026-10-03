import { describe, expect, it } from 'vitest'
import { describeAirspeedDevice } from './devid.js'
import { paramFileText, ratioSuggestions, outOfRangeText } from './params.js'
import type { CombinedFit } from './core.js'
import type { AirspeedSensor } from './load.js'

describe('describeAirspeedDevice', () => {
  it('describes devices like the upstream sensor summary', () => {
    expect(describeAirspeedDevice(undefined, 1)).toBe('ARSP instance 1')
    expect(describeAirspeedDevice(1 | (0x28 << 8) | (2 << 16), 0)).toBe('MS4525 via I2C')
    // DroneCAN: the usual unset sensor id (devtype 0, i.e. -1) is hidden, a real one shown
    expect(describeAirspeedDevice(3 | (1 << 3) | (12 << 8), 0)).toBe('DRONECAN bus: 1 node id: 12')
    expect(describeAirspeedDevice(3 | (12 << 8) | (3 << 16), 0)).toBe('DRONECAN bus: 0 node id: 12 sensor: 2')
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
