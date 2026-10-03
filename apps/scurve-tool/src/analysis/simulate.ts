/**
 * Fly the four-waypoint mission through ArduPilot's WPNav, the way Copter's Auto mode does, and
 * record the 3D target kinematics plus each leg's 1D S-curve.
 *
 * Upstream: `replot()` and `add_curve()` in `SCurveTool/SCurveTool.js`.
 */
import type { AttitudeSettings, Curve1D, PosControlSettings, WpNav, WpNavEngine, WpNavLimits } from './engine.js'
import type { ParamValues } from './params.js'
import { toNed, type Mission } from './waypoints.js'

/** Copter's 400 Hz loop. */
export const DT = 1 / 400
/** Simulated time after which the mission is abandoned, seconds. */
export const MAX_TIME = 1000
/** Upstream passes a fixed 10 m terrain margin; terrain is not simulated. */
const TERRAIN_MARGIN_M = 10

/** Three NED columns, one row per sample. */
export interface Vec3Columns {
  readonly north: Float64Array
  readonly east: Float64Array
  readonly down: Float64Array
}

export interface Simulation {
  /** Time of each sample, seconds from the start of the mission. */
  readonly time: Float64Array
  /** Position estimate, metres. */
  readonly position: Vec3Columns
  /** Desired velocity, m/s. */
  readonly velocity: Vec3Columns
  /** Desired acceleration, m/s². */
  readonly acceleration: Vec3Columns
  /** Finite difference of the acceleration, m/s³; zero at the first sample. */
  readonly jerk: Vec3Columns
  /** Each leg's 1D S-curve, time offset to when the leg started. */
  readonly legs: readonly Curve1D[]
  /** False when the last waypoint was not reached within `MAX_TIME`. */
  readonly completed: boolean
}

export function wpNavLimits(p: ParamValues): WpNavLimits {
  return {
    speedMs: p.WP_SPD,
    speedUpMs: p.WP_SPD_UP,
    speedDownMs: p.WP_SPD_DN,
    radiusM: p.WP_RADIUS_M,
    accelMss: p.WP_ACC,
    accelCornerMss: p.WP_ACC_CNR,
    accelZMss: p.WP_ACC_Z,
    jerkMsss: p.WP_JERK,
    terrainMarginM: TERRAIN_MARGIN_M
  }
}

export function posControlSettings(p: ParamValues, dtS: number): PosControlSettings {
  return {
    neKp: p.PSC_NE_POS_P,
    accelZFilterTargetHz: p.PSC_D_ACC_FLTT,
    accelZFilterErrorHz: p.PSC_D_ACC_FLTE,
    shapingJerkNeMsss: p.PSC_JERK_NE,
    shapingJerkDMsss: p.PSC_JERK_D,
    dtS
  }
}

export function attitudeSettings(p: ParamValues): AttitudeSettings {
  return {
    rollRateMaxDegs: p.ATC_RATE_R_MAX,
    pitchRateMaxDegs: p.ATC_RATE_P_MAX,
    rollAccelMaxDegss: p.ATC_ACC_R_MAX,
    pitchAccelMaxDegss: p.ATC_ACC_P_MAX,
    inputTc: p.ATC_INPUT_TC,
    rateFeedForward: p.ATC_RATE_FF_ENAB === 1
  }
}

/** Growable NED column buffer. */
class Vec3Recorder {
  private readonly n: number[] = []
  private readonly e: number[] = []
  private readonly d: number[] = []

  push(v: readonly [number, number, number]): void {
    this.n.push(v[0])
    this.e.push(v[1])
    this.d.push(v[2])
  }

  columns(): Vec3Columns {
    return { north: Float64Array.from(this.n), east: Float64Array.from(this.e), down: Float64Array.from(this.d) }
  }
}

/** `add_curve`: the current leg's S-curve with its time shifted to `startTime`. */
function recordCurve(nav: WpNav, startTime: number, dtS: number): Curve1D {
  const curve = nav.currentCurve(dtS)
  const time = new Float64Array(curve.time.length)
  for (let i = 0; i < time.length; i++) time[i] = curve.time[i]! + startTime
  return { ...curve, time }
}

/** Per-sample finite difference of `a` over `dtS`, starting at zero (upstream's jerk). */
export function differentiate(a: Vec3Columns, dtS: number): Vec3Columns {
  const diff = (c: Float64Array) => {
    const out = new Float64Array(c.length)
    for (let i = 1; i < c.length; i++) out[i] = (c[i]! - c[i - 1]!) / dtS
    return out
  }
  return { north: diff(a.north), east: diff(a.east), down: diff(a.down) }
}

/** Euclidean norm of each row. */
export function magnitude(v: Vec3Columns): Float64Array {
  const out = new Float64Array(v.north.length)
  for (let i = 0; i < out.length; i++) {
    const n = v.north[i]!
    const e = v.east[i]!
    const d = v.down[i]!
    out[i] = Math.sqrt(n * n + e * e + d * d)
  }
  return out
}

/** Fly `mission` with `params` and record the result. */
export function simulateMission(engine: WpNavEngine, mission: Mission, params: ParamValues, dtS = DT): Simulation {
  const [p1, p2, p3, p4] = [toNed(mission[0]), toNed(mission[1]), toNed(mission[2]), toNed(mission[3])]
  return engine.withWpNav((nav) => {
    nav.setLimits(wpNavLimits(params))
    nav.setPosControl(posControlSettings(params, dtS))
    nav.setAttitude(attitudeSettings(params))

    // wp_start(): this follows Copter's Auto mode.
    nav.setInitialPosition(p1)
    nav.init(p1)
    nav.setDestination(p2)
    nav.setNextDestination(p3)

    const legs: Curve1D[] = [recordCurve(nav, 0, dtS)]

    // wp_run()
    const steps = Math.floor(MAX_TIME / dtS)
    const time: number[] = []
    const position = new Vec3Recorder()
    const velocity = new Vec3Recorder()
    const acceleration = new Vec3Recorder()
    let t = 0
    let destination: 2 | 3 | 4 = 2
    let completed = false
    for (let i = 0; i < steps; i++) {
      nav.advance(dtS)

      t += dtS
      time.push(t)
      position.push(nav.position())
      velocity.push(nav.velocity())
      acceleration.push(nav.acceleration())

      if (nav.reachedDestination()) {
        if (destination === 4) {
          completed = true
          break
        }
        if (destination === 2) {
          nav.setDestination(p3)
          nav.setNextDestination(p4)
          destination = 3
        } else {
          nav.setDestination(p4)
          nav.setNextDestination(p4)
          destination = 4
        }
        legs.push(recordCurve(nav, t, dtS))
      }
    }

    const accel = acceleration.columns()
    return {
      time: Float64Array.from(time),
      position: position.columns(),
      velocity: velocity.columns(),
      acceleration: accel,
      jerk: differentiate(accel, dtS),
      legs,
      completed
    }
  })
}
