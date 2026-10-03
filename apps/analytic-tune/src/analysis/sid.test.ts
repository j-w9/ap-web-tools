import { describe, expect, it } from 'vitest'
import { SidRunError, detectTuneVehicle, findSidRuns, sidAxisLabel, tuneAxisForSid } from './sid.js'

describe('findSidRuns', () => {
  const time = [10, 10.1, 10.2, 10.3, 20, 20.1, 20.2, 50, 50.5, 51]

  it('splits at gaps over half a second and pairs runs with SIDS records', () => {
    expect(findSidRuns(time, [7, 8, 9], [5, 5, 5])).toEqual([
      { axis: 7, startTime: 10, endTime: 10.3 },
      { axis: 8, startTime: 20, endTime: 20.2 },
      { axis: 9, startTime: 50, endTime: 51 }
    ])
  })

  it('limits a run to the chirp length plus a second', () => {
    const t = [10, 10.4, 10.8, 11.2, 11.6, 12, 20, 20.4, 20.8, 21.2]
    expect(findSidRuns(t, [1, 2], [0.5, 0.1])).toEqual([
      { axis: 1, startTime: 10, endTime: 10 + 0.5 + 1.0 },
      { axis: 2, startTime: 20, endTime: 20 + 0.1 + 1.0 }
    ])
    // Without a SIDS length for a segment, no limit applies.
    expect(findSidRuns(t, [1], [0.5])).toEqual([{ axis: 1, startTime: 10, endTime: 11.5 }])
  })

  it('lists only as many runs as SIDS records, and fails like upstream for records without data', () => {
    expect(findSidRuns(time, [4], [5])).toHaveLength(1)
    expect(() => findSidRuns([1, 1.1], [4, 5], [5, 5])).toThrow(SidRunError)
    expect(findSidRuns([], [4], [5])).toEqual([])
  })
})

describe('SID axes', () => {
  it('maps runs to rate controller axes', () => {
    expect([1, 4, 7, 10, 20, 23].map(tuneAxisForSid)).toEqual(Array(6).fill('Roll'))
    expect([2, 5, 8, 11, 21, 24].map(tuneAxisForSid)).toEqual(Array(6).fill('Pitch'))
    expect([3, 6, 9, 12, 22, 25].map(tuneAxisForSid)).toEqual(Array(6).fill('Yaw'))
    expect([13, 14, 19, 26, 0].map(tuneAxisForSid)).toEqual(Array(5).fill(null))
  })

  it('labels axes', () => {
    expect(sidAxisLabel(7)).toBe('7: Rate Roll')
    expect(sidAxisLabel(99)).toBe('99')
  })
})

describe('detectTuneVehicle', () => {
  it('uses the first firmware banner', () => {
    expect(detectTuneVehicle(['Frame: QUAD', 'ArduCopter V4.6.0'], 1)).toBe('copter')
    expect(detectTuneVehicle(['ArduPlane V4.6.0', 'ArduCopter'], 7)).toBe('quadplane')
    expect(detectTuneVehicle(['ArduPlane V4.6.0'], 20)).toBe('fixed-wing')
    expect(detectTuneVehicle(['ArduPlane V4.6.0'], undefined)).toBe('quadplane')
    expect(detectTuneVehicle([], 20)).toBe('copter')
  })

  it('keeps the previous vehicle without a banner, as upstream keeps vehicle_type', () => {
    expect(detectTuneVehicle(['Frame: QUAD'], 7, 'fixed-wing')).toBe('fixed-wing')
    expect(detectTuneVehicle(['ArduCopter V4.6.0'], 7, 'fixed-wing')).toBe('copter')
  })
})
