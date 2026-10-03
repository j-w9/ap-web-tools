/** Simulation state, the shared run loop and the sampled results the plots draw. */

/** Both upstream pages stop simulating after 20 s whatever happens. */
export const MAX_TIME = 20

/** A shaper's state history; index `i` is time `i * dt`. Grows as the simulation runs. */
export interface StateHistory {
  pos: number[]
  vel: number[]
  accel: number[]
}

export function initialHistory(pos: number, vel: number): StateHistory {
  return { pos: [pos], vel: [vel], accel: [0] }
}

/** A sampled single-axis trajectory in degrees, degrees per second and degrees per second². */
export interface Trajectory {
  time: Float64Array
  pos: Float64Array
  vel: Float64Array
  accel: Float64Array
}

/** Jerk in degrees per second³, sampled on its own time base. */
export interface JerkSeries {
  time: Float64Array
  jerk: Float64Array
}

/** One shaping method's output: its trajectory and, for jerk-limited methods, its jerk. */
export interface MethodResult {
  trajectory: Trajectory
  jerk: JerkSeries | null
}

/** Horizontal reference lines for the angle and rate plots; `null` when not commanded. */
export interface Targets {
  angle: number | null
  rate: number | null
}

export interface RunOptions {
  dt: number
  /** Minimum run time (s). */
  endTime: number
  /** Hard stop (s). */
  maxTime: number
  /** Advance every shaper to sample `i`. */
  step: (i: number) => void
  /** Whether every shaper has reached the target at sample `i`. */
  settled: (i: number) => boolean
}

/**
 * The upstream `run_attitude` loop: step until the shapers settle, then keep going until 0.5 s
 * after settling and at least `endTime`, never beyond `maxTime`. Returns the sample times.
 */
export function runUntilSettled({ dt, endTime, maxTime, step, settled }: RunOptions): Float64Array {
  const time = [0]
  let doneTime: number | null = null
  for (let i = 1; ; i++) {
    step(i)
    const t = i * dt
    time.push(t)
    if (doneTime === null) {
      if (settled(i)) doneTime = t
    } else if (t > Math.max(doneTime + 0.5, endTime)) {
      break
    }
    if (t >= maxTime) break
  }
  return Float64Array.from(time)
}

/** Scale a history into a trajectory, e.g. radians to degrees. */
export function toTrajectory(time: Float64Array, history: StateHistory, scale = 1): Trajectory {
  const scaled = (values: readonly number[]) => Float64Array.from(values, (v) => v * scale)
  return { time, pos: scaled(history.pos), vel: scaled(history.vel), accel: scaled(history.accel) }
}

/** Jerk by differencing acceleration, placed half a step later (upstream `jerkTime`). */
export function differentiateAccel(time: Float64Array, accel: readonly number[], dt: number, scale = 1): JerkSeries {
  const n = Math.max(0, Math.min(time.length, accel.length) - 1)
  const jerkTime = new Float64Array(n)
  const jerk = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    jerkTime[i] = time[i]! + dt * 0.5
    jerk[i] = (accel[i + 1]! - accel[i]!) * ((1 / dt) * scale)
  }
  return { time: jerkTime, jerk }
}
