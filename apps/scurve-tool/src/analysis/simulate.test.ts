import { describe, expect, it } from 'vitest'
import { nodeEngine } from '../wasm/test-utils/node.js'
import { CURVE_KEYS } from './engine.js'
import { axisRange, colourValues, sphereMesh } from './path3d.js'
import { DEFAULT_PARAMS, type ParamValues } from './params.js'
import { differentiate, magnitude, simulateMission, type Simulation } from './simulate.js'
import { runUpstream, type UpstreamResult } from './test-utils/upstream.js'
import { DEFAULT_MISSION, type Mission } from './waypoints.js'

const NONE = { display_wp_radius: false, display_wp_vel: false, display_wp_accel: false, display_wp_jerk: false }

const CASES: readonly { name: string; mission: Mission; params: ParamValues }[] = [
  { name: 'upstream defaults', mission: DEFAULT_MISSION, params: DEFAULT_PARAMS },
  {
    name: 'tight radius, faster, no feed-forward',
    mission: [
      { north: -100, east: 20, up: 50 },
      { north: 120, east: -80, up: 90 },
      { north: 150, east: 200, up: 40 },
      { north: -50, east: 100, up: 120 }
    ],
    params: {
      ...DEFAULT_PARAMS,
      WP_RADIUS_M: 2,
      WP_SPD: 15,
      WP_ACC: 4,
      WP_ACC_CNR: 3,
      WP_JERK: 3,
      ATC_RATE_FF_ENAB: 0,
      ATC_ACC_R_MAX: 720,
      ATC_ACC_P_MAX: 720,
      PSC_JERK_NE: 10
    }
  }
]

function path(sim: Simulation) {
  return { x: Array.from(sim.position.north), y: Array.from(sim.position.east), z: Array.from(sim.position.down, (d) => -d) }
}

describe('simulateMission matches upstream replot()', () => {
  for (const c of CASES) {
    describe(c.name, () => {
      let upstream: UpstreamResult
      let sim: Simulation

      it('runs both', async () => {
        upstream = await runUpstream(c.mission, c.params, { ...NONE, display_wp_vel: true })
        sim = simulateMission(await nodeEngine(), c.mission, c.params)
        expect(sim.completed).toBe(true)
      }, 60_000)

      it('places the waypoints', () => {
        const wp = upstream.path[0]!
        expect(wp.x).toEqual(c.mission.map((w) => w.north))
        expect(wp.y).toEqual(c.mission.map((w) => w.east))
        expect(wp.z).toEqual(c.mission.map((w) => w.up))
      })

      it('flies the same target path', () => {
        const target = upstream.path[1]!
        expect(sim.time.length).toBe(target.x.length)
        expect(path(sim)).toEqual({ x: target.x, y: target.y, z: target.z })
      })

      it('colours by the same velocity magnitude', () => {
        expect(Array.from(colourValues(sim, 'velocity') ?? [])).toEqual(upstream.path[1]!.line!.color)
      })

      it('records the same 1D S-curves for each leg', () => {
        expect(sim.legs.length).toBe(upstream.curves.length)
        sim.legs.forEach((leg, i) => {
          const ref = upstream.curves[i]!
          expect(Array.from(leg.time)).toEqual(ref.time)
          for (const key of CURVE_KEYS) expect(Array.from(leg[key])).toEqual(ref[key])
        })
      })

      it('uses the same cube axis range', () => {
        const [min, max] = axisRange(c.mission, c.params.WP_RADIUS_M)
        expect(upstream.ranges).toEqual({ x: [max, min], y: [min, max], z: [min, max] })
      })
    })
  }

  it('colours by acceleration and jerk like upstream', async () => {
    const sim = simulateMission(await nodeEngine(), DEFAULT_MISSION, DEFAULT_PARAMS)
    const accel = await runUpstream(DEFAULT_MISSION, DEFAULT_PARAMS, { ...NONE, display_wp_accel: true })
    expect(Array.from(colourValues(sim, 'acceleration') ?? [])).toEqual(accel.path[1]!.line!.color)
    const jerk = await runUpstream(DEFAULT_MISSION, DEFAULT_PARAMS, { ...NONE, display_wp_jerk: true })
    expect(Array.from(colourValues(sim, 'jerk') ?? [])).toEqual(jerk.path[1]!.line!.color)
    const plain = await runUpstream(DEFAULT_MISSION, DEFAULT_PARAMS, NONE)
    expect(plain.path[1]!.line!.color).toBe('rgba(0, 0, 0, 1)')
    expect(colourValues(sim, 'none')).toBeNull()
  }, 60_000)

  it('draws the same waypoint-radius spheres', async () => {
    const upstream = await runUpstream(DEFAULT_MISSION, DEFAULT_PARAMS, { ...NONE, display_wp_radius: true })
    expect(upstream.path.length).toBe(6)
    DEFAULT_MISSION.forEach((w, i) => {
      const ref = upstream.path[2 + i]!
      const mesh = sphereMesh(w, DEFAULT_PARAMS.WP_RADIUS_M, 100)
      expect(ref.type).toBe('mesh3d')
      expect({
        x: Array.from(mesh.x),
        y: Array.from(mesh.y),
        z: Array.from(mesh.z),
        i: Array.from(mesh.i),
        j: Array.from(mesh.j),
        k: Array.from(mesh.k)
      }).toEqual({
        x: ref.x,
        y: ref.y,
        z: ref.z,
        i: ref.i,
        j: ref.j,
        k: ref.k
      })
    })
  }, 60_000)
})

describe('kinematics helpers', () => {
  it('differentiates per sample, starting at zero', () => {
    const a = { north: Float64Array.of(0, 1, 3), east: Float64Array.of(1, 1, 1), down: Float64Array.of(0, -2, -2) }
    const j = differentiate(a, 0.5)
    expect(Array.from(j.north)).toEqual([0, 2, 4])
    expect(Array.from(j.east)).toEqual([0, 0, 0])
    expect(Array.from(j.down)).toEqual([0, -4, 0])
  })

  it('takes the norm of each row', () => {
    const v = { north: Float64Array.of(3, 0), east: Float64Array.of(4, 0), down: Float64Array.of(0, -2) }
    expect(Array.from(magnitude(v))).toEqual([5, 2])
  })

  it('reports an unfinished mission', () => {
    // A stub engine that never reaches its destination.
    let deleted = 0
    const sim = simulateMission(
      {
        withWpNav: (body) => {
          try {
            return body({
              setLimits() {},
              setPosControl() {},
              setAttitude() {},
              setInitialPosition() {},
              init() {},
              setDestination: () => true,
              setNextDestination: () => true,
              advance: () => true,
              reachedDestination: () => false,
              position: () => [0, 0, 0],
              velocity: () => [0, 0, 0],
              acceleration: () => [0, 0, 0],
              currentCurve: () => {
                const z = new Float64Array(1)
                return { time: z, pos: z, vel: z, accel: z, jerk: z, snap: z }
              }
            })
          } finally {
            deleted++
          }
        }
      },
      DEFAULT_MISSION,
      DEFAULT_PARAMS,
      10
    )
    expect(sim.completed).toBe(false)
    expect(sim.time.length).toBe(100)
    expect(sim.legs.length).toBe(1)
    expect(deleted).toBe(1)
  })
})
