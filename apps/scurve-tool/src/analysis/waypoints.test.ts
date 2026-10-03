import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, PARAMS, paramsInGroup, rangeHint } from './params.js'
import { DEFAULT_MISSION, toNed, withWaypointValue } from './waypoints.js'

describe('waypoints', () => {
  it('replaces one coordinate without touching the rest', () => {
    const next = withWaypointValue(DEFAULT_MISSION, 2, 'up', 42)
    expect(next[2]).toEqual({ north: 70, east: 35, up: 42 })
    expect(next[0]).toBe(DEFAULT_MISSION[0])
    expect(DEFAULT_MISSION[2].up).toBe(80)
  })

  it('converts up to NED down', () => {
    expect(toNed({ north: 1, east: 2, up: 3 })).toEqual({ north: 1, east: 2, down: -3 })
  })
})

describe('params', () => {
  it('has upstream defaults', () => {
    expect(DEFAULT_PARAMS.WP_SPD).toBe(10)
    expect(DEFAULT_PARAMS.WP_RADIUS_M).toBe(50)
    expect(DEFAULT_PARAMS.ATC_RATE_FF_ENAB).toBe(1)
    expect(Object.keys(DEFAULT_PARAMS)).toHaveLength(PARAMS.length)
  })

  it('groups params in upstream order', () => {
    expect(paramsInGroup('position').map((p) => p.name)).toEqual([
      'PSC_JERK_NE',
      'PSC_JERK_D',
      'PSC_NE_POS_P',
      'PSC_D_ACC_FLTT',
      'PSC_D_ACC_FLTE'
    ])
  })

  it('describes ranges', () => {
    const spd = PARAMS.find((p) => p.name === 'WP_SPD')
    const ff = PARAMS.find((p) => p.name === 'ATC_RATE_FF_ENAB')
    expect(spd && rangeHint(spd)).toBe('Range 0.1 to 20, step 0.1')
    expect(ff && rangeHint(ff)).toBeNull()
  })
})
