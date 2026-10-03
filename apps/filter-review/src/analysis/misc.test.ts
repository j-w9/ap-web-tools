import { describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { NOTCH_PREFIXES, notchParamNames, unsignedBitmask } from './filter-params.js'
import { readFilterVersion } from './filter-version.js'
import { defaultTimeRange, throttleActiveRange } from './flight-data.js'
import { firstParamIgnoringChanges } from './log-params.js'
import { fixture } from './test-utils/logs.js'
import { findEndIndex, findStartIndex } from './time-index.js'

describe('time index helpers', () => {
  const time = [0, 1, 2, 3, 4]
  it('find the window around a range like upstream', () => {
    expect(findStartIndex(time, 2.5)).toBe(2)
    expect(findStartIndex(time, -1)).toBe(0)
    expect(findEndIndex(time, 2.5)).toBe(3)
    // Capped one before the end; callers add one
    expect(findEndIndex(time, 100)).toBe(4)
  })
})

describe('parameters', () => {
  it('names notch params', () => {
    expect(NOTCH_PREFIXES).toEqual(['INS_HNTCH_', 'INS_HNTC2_'])
    expect(notchParamNames(1).minRatio).toBe('INS_HNTC2_FM_RAT')
    expect(() => notchParamNames(2)).toThrow()
  })

  it('converts narrow bitmasks to unsigned', () => {
    expect(unsignedBitmask(-1, 8)).toBe(255)
    expect(unsignedBitmask(-128, 8)).toBe(128)
    expect(unsignedBitmask(3, 8)).toBe(3)
    expect(unsignedBitmask(-1, 32)).toBe(-1)
  })

  it('reads first and last parameter values', () => {
    const log = DataflashLog.parse(fixture('copter-sitl.bin'))
    expect(firstParamIgnoringChanges(log, 'SCHED_LOOP_RATE')).toBe(400)
    expect(firstParamIgnoringChanges(log, 'NO_SUCH_PARAM')).toBeUndefined()
  })
})

describe('log metadata', () => {
  it('reads vehicle and filter version from VER', () => {
    const log = DataflashLog.parse(fixture('copter-sitl.bin'))
    expect(log.vehicleType()).toBe('copter')
    expect(readFilterVersion(log)).toEqual({ version: 4 })
  })
})

describe('default time range', () => {
  const series = (value: number[]) => ({ time: Float64Array.from(value.map((_, i) => i * 1.5)), value: Float64Array.from(value) })

  it('crops to positive throttle with a one second margin', () => {
    const throttle = series([0, 0, 0.3, 0.4, 0.5, 0.4, 0.3, 0.2, 0.1, 0, 0])
    expect(throttleActiveRange(throttle)).toEqual({ first: 3, last: 12 })
    expect(defaultTimeRange(0.2, 14.7, throttle)).toEqual({ dataStart: 0, dataEnd: 15, start: 4, end: 11 })
  })

  it('ignores a throttle that is positive from the first sample, as upstream', () => {
    const throttle = series([0.2, 0.3, 0.4])
    expect(throttleActiveRange(throttle).first).toBeUndefined()
    expect(defaultTimeRange(0.2, 14.7, throttle)).toEqual({ dataStart: 0, dataEnd: 15, start: 0, end: 15 })
  })
})
