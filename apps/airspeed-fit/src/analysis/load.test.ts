import { describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { buildSyntheticAirspeedLog, FIELD_ELEVATION } from '../test-utils/synthetic-log.js'
import { createUpstreamTool, readFixture, upstreamLoad } from '../test-utils/upstream.js'
import { describeAirspeedDevice } from './devid.js'
import { prepareFit, runWindModel, seedWarnings, sliderToQ, Q_SLIDER } from './fit.js'
import { loadAirspeedLog } from './load.js'

describe('loadAirspeedLog', () => {
  it('rejects a copter log without airspeed, with the same message upstream alerts', async () => {
    const buffer = readFixture('copter-sitl.bin')
    expect(() => loadAirspeedLog(DataflashLog.parse(buffer))).toThrow('No airspeed (ARSP) data in log')
    const up = await createUpstreamTool()
    await upstreamLoad(up, buffer)
    expect(up.alerts).toEqual(['No airspeed (ARSP) data in log'])
  }, 60_000)

  it('reads sensors, sources and temperature presets from a plane log', () => {
    const log = loadAirspeedLog(DataflashLog.parse(buildSyntheticAirspeedLog()))
    expect(log.sensors.map((s) => [s.ratioName, s.useName, s.currentRatio, s.use, s.healthy, s.primary])).toEqual([
      ['ARSPD_RATIO', 'ARSPD_USE', 2, 1, true, true],
      ['ARSPD2_RATIO', 'ARSPD2_USE', 2, 1, true, false]
    ])
    expect(log.sensors.map((s) => describeAirspeedDevice(s.devId, s.instance))).toEqual([
      'MS4525 via I2C',
      'DRONECAN bus: 1 node id: 12'
    ])
    expect(log.sources.map((s) => s.name)).toEqual(['EKF3 core 0', 'EKF3 core 1'])
    expect(log.sources[0].wind).not.toBeNull()
    expect(log.field?.elevation).toBeCloseTo(FIELD_ELEVATION, 3)
    expect(log.tempSources.metar).toBe(18)
    expect(log.tempSources.baro).toBe(35)
    expect(log.tempSources.isa).toBeCloseTo(15 - 0.0065 * FIELD_ELEVATION, 3)
    // The flight runs 60 s to 660 s after boot plus the 1 s log start.
    expect(log.autoWindow[0]).toBeGreaterThanOrEqual(60)
    expect(log.autoWindow[1]).toBeLessThanOrEqual(662)
  })

  it('recovers the true ratios at the true temperature', () => {
    const log = loadAirspeedLog(DataflashLog.parse(buildSyntheticAirspeedLog({ trueRatios: [1.7, 2.6] })))
    const prepared = prepareFit(log, { source: 'EKF3 core 0', groundTempC: 20, window: log.autoWindow })
    const model = runWindModel(prepared, sliderToQ(Q_SLIDER.initial))
    expect(model?.sensors.map((s) => s.ratio.toFixed(2))).toEqual(['1.70', '2.60'])
    expect(seedWarnings(prepared)).toEqual([])
  })

  it('warns that a straight leg cannot separate wind and ratio', () => {
    const log = loadAirspeedLog(DataflashLog.parse(buildSyntheticAirspeedLog({ straight: true, trueRatios: [2] })))
    const prepared = prepareFit(log, { source: 'EKF3 core 0', groundTempC: 20, window: log.autoWindow })
    expect(seedWarnings(prepared).some((w) => w.startsWith('little course variation'))).toBe(true)
  })
})
