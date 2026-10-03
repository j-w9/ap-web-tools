import { describe, expect, it } from 'vitest'
import { nodeModule } from './test-utils/node.js'
import type { AC_WPNav_wrapper, WPNavModuleInstance } from './wpnav-glue.js'
import { createEngine } from './wpnav-engine.js'
import { DEFAULT_PARAMS } from '../analysis/params.js'
import { DT, attitudeSettings, posControlSettings, wpNavLimits } from '../analysis/simulate.js'

/** Wraps the real module so the test can see every instance it hands out. */
async function trackedModule(): Promise<{ module: WPNavModuleInstance; instances: AC_WPNav_wrapper[] }> {
  const real = await nodeModule()
  const instances: AC_WPNav_wrapper[] = []
  const tracked = new Proxy(real.AC_WPNav_wrapper, {
    construct(target, args) {
      const w = Reflect.construct(target, args)
      instances.push(w)
      return w
    }
  })
  return { module: { AC_WPNav_wrapper: tracked }, instances }
}

describe('createEngine', () => {
  it('frees the embind instance after use', async () => {
    const { module, instances } = await trackedModule()
    const pos = createEngine(module).withWpNav((nav) => {
      nav.setInitialPosition({ north: 1, east: 2, down: -3 })
      return nav.position()
    })
    expect(Array.from(pos)).toEqual([1, 2, -3])
    expect(instances.length).toBe(1)
    expect(instances[0]!.isDeleted()).toBe(true)
  })

  it('frees the instance when the caller throws', async () => {
    const { module, instances } = await trackedModule()
    expect(() =>
      createEngine(module).withWpNav(() => {
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(instances[0]!.isDeleted()).toBe(true)
  })

  it('samples a leg as a 1D curve starting at zero', async () => {
    const curve = createEngine(await nodeModule()).withWpNav((nav) => {
      nav.setLimits(wpNavLimits(DEFAULT_PARAMS))
      nav.setPosControl(posControlSettings(DEFAULT_PARAMS, DT))
      nav.setAttitude(attitudeSettings(DEFAULT_PARAMS))
      nav.setInitialPosition({ north: 0, east: 0, down: -10 })
      nav.init({ north: 0, east: 0, down: -10 })
      nav.setDestination({ north: 50, east: 0, down: -10 })
      return nav.currentCurve(0.01)
    })
    expect(curve.time[0]).toBe(0)
    expect(curve.pos[0]).toBe(0)
    expect(curve.time.length).toBe(curve.snap.length)
    expect(curve.pos[curve.pos.length - 1]).toBeCloseTo(50, 1)
  })
})
