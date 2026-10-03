import { describe, expect, it } from 'vitest'
import { buildSyntheticMagLog, SYNTHETIC_LAT, SYNTHETIC_LON } from '../test-utils/synthetic-mag-log.js'
import { readFixture } from '../test-utils/upstream.js'
import { loadMagFitLog } from './load.js'
import { motorSourceAt } from './motor.js'

describe('loadMagFitLog', () => {
  it('loads the SITL fixture', () => {
    const log = loadMagFitLog(readFixture('copter-sitl.bin'))
    expect(log.compasses.map((c) => c?.index)).toEqual([0, 1, 2])
    expect(log.location.source).toBe('ORGN')
    expect(log.attitudeSources.map((s) => s.name)).toEqual(['DCM', 'EKF 3 IMU 1'])
    expect(log.defaultAttitudeSource).toBe(1)
    // SITL battery reports no current, so there is nothing to fit motor compensation against.
    expect(log.motorSources).toEqual([])
    expect(log.compasses[0]!.rotated).toBe(true)
    expect(log.compasses[1]!.rotated).toBe(false)
    expect(log.compasses[0]!.healthy).toBe(true)
    expect(log.endTime).toBeGreaterThan(log.startTime)
    expect(log.flight.roll?.values.length).toBeGreaterThan(0)
    expect(log.flight.altitude?.time.length).toBe(log.flight.altitude?.values.length)
  })

  it('rejects a log without compass data', () => {
    expect(() => loadMagFitLog(readFixture('copter-files.bin'))).toThrow('No compass data in log')
  })

  it('rejects a log without a location', () => {
    expect(() => loadMagFitLog(buildSyntheticMagLog({ duration: 5, origin: false }))).toThrow(
      'Could not get earth field for Lat: undefined Lng: undefined'
    )
  })

  it('loads a synthetic log with current and partial compasses', () => {
    const log = loadMagFitLog(buildSyntheticMagLog({ duration: 10, compasses: [1] }))
    expect(log.compasses.map((c) => c !== undefined)).toEqual([false, true, false])
    expect(log.location.lat).toBeCloseTo(SYNTHETIC_LAT, 6)
    expect(log.location.lon).toBeCloseTo(SYNTHETIC_LON, 6)
    expect(log.motorSources.map((m) => [m.name, m.type])).toEqual([['Battery 1 current', 2]])
    const noBattery = loadMagFitLog(buildSyntheticMagLog({ duration: 10, battery: false }))
    expect(noBattery.motorSources).toEqual([])
  })

  it('resamples motor sources onto each compass time base', () => {
    const source = { name: 'b', type: 2 as const, time: Float64Array.of(0, 1, 2), value: Float64Array.of(0, 10, 30) }
    expect(Array.from(motorSourceAt(source, [-1, 0.5, 1.5, 5]))).toEqual([0, 5, 20, 30])
  })
})
