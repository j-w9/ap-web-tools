import { describe, expect, it } from 'vitest'
import type { Simulation } from '../analysis/simulate.js'
import { DEFAULT_MISSION } from '../analysis/waypoints.js'
import { curveLayout, curveTraces, pathLayout, pathTraces, radiusTraces } from './traces.js'

const col = (...v: number[]) => Float64Array.from(v)
const vec = (n: number[], e: number[], d: number[]) => ({ north: col(...n), east: col(...e), down: col(...d) })
const SIM: Simulation = {
  time: col(0.1, 0.2),
  position: vec([1, 2], [3, 4], [-5, -6]),
  velocity: vec([3, 0], [4, 0], [0, 1]),
  acceleration: vec([0, 0], [0, 0], [0, 0]),
  jerk: vec([0, 0], [0, 0], [0, 0]),
  legs: [{ time: col(0, 1), pos: col(0, 1), vel: col(0, 2), accel: col(0, 3), jerk: col(0, 4), snap: col(0, 5) }],
  completed: true
}

describe('path traces', () => {
  it('plots up as positive z and colours by the chosen magnitude', () => {
    const [wp, target] = pathTraces(DEFAULT_MISSION, SIM, 'velocity')
    expect(wp).toMatchObject({ type: 'scatter3d', z: [300, 150, 80, 80] })
    expect(target).toMatchObject({ z: col(5, 6), line: { color: [5, 1], colorscale: 'Viridis', showscale: true } })
  })

  it('draws a plain line with no scale when not colouring', () => {
    const [, target] = pathTraces(DEFAULT_MISSION, SIM, 'none')
    expect(target).toMatchObject({ line: { showscale: false } })
  })

  it('draws one sphere per waypoint', () => {
    expect(radiusTraces(DEFAULT_MISSION, 5).map((t) => t.type)).toEqual(['mesh3d', 'mesh3d', 'mesh3d', 'mesh3d'])
  })

  it('reverses north and shares one range', () => {
    const scene = pathLayout([-10, 20]).scene
    expect(scene?.xaxis?.range).toEqual([20, -10])
    expect(scene?.yaxis?.range).toEqual([-10, 20])
    expect(scene?.zaxis?.range).toEqual([-10, 20])
  })
})

describe('curve traces', () => {
  it('draws one trace per leg with units in the axis title', () => {
    expect(curveTraces(SIM.legs, 'jerk')).toMatchObject([{ name: 'Leg 1', y: col(0, 4) }])
    expect(curveLayout('snap').yaxis?.title).toEqual({ text: 'Snap (m/s⁴)' })
  })
})
