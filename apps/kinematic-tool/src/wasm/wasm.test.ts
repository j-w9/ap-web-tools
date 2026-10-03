import { beforeAll, describe, expect, it } from 'vitest'
import { loadTestLibs } from '../test-utils/wasm.js'
import type { ControlLib } from './control.js'
import { sampleTimes, type RuckigLib } from './ruckig-planner.js'

let libs: { control: ControlLib; ruckig: RuckigLib }
beforeAll(async () => {
  libs = await loadTestLibs()
})

describe('control.wasm', () => {
  it('runs sqrt_controller in single precision', () => {
    // Linear region: error * p, rounded to float.
    expect(libs.control.sqrtController({ error: 0.01, p: 2, secondOrderLimit: 100, dt: 0.0025 })).toBe(Math.fround(0.02))
  })

  it('accelerates towards a target no faster than the jerk limit allows', () => {
    const accel = libs.control.shapeAngleVelAccel({
      desired: { pos: 1, vel: 0, accel: 0 },
      current: { pos: 0, vel: 0, accel: 0 },
      velMin: -10,
      velMax: 10,
      accelMax: 20,
      jerkMax: 100,
      dt: 0.01,
      limitTotal: true
    })
    expect(accel).toBeCloseTo(1, 5)
  })
})

describe('ruckig', () => {
  it('plans a rest-to-rest move that ends on the target', () => {
    const plan = libs.ruckig.plan({
      interface: 'position',
      start: { pos: 0, vel: 0, accel: 0 },
      target: { pos: 1, vel: 0, accel: 0 },
      maxVel: Infinity,
      maxAccel: 10,
      maxJerk: 100,
      dt: 0.01
    })
    if (!plan.ok) throw new Error(plan.message)
    const { pos, jerk } = plan.trajectory
    expect(pos[pos.length - 1]).toBeCloseTo(1, 2)
    expect(Math.max(...jerk.map(Math.abs))).toBeLessThanOrEqual(100 + 1e-9)
  })

  it('samples like upstream array_from_range', () => {
    expect(Array.from(sampleTimes(0, 1, 0.25))).toEqual([0, 0.25, 0.5, 0.75, 1])
  })

  it('rejects the lengths upstream new Array rejects', () => {
    expect(() => sampleTimes(0, NaN, 0.25)).toThrow(RangeError)
    expect(() => sampleTimes(0, Infinity, 0.25)).toThrow(RangeError)
    expect(() => sampleTimes(0, -1, 0.25)).toThrow(RangeError)
  })
})
