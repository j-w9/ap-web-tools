/**
 * Typed wrapper around the Ruckig time-optimal, jerk-limited trajectory planner
 * (https://github.com/pantor/ruckig), used as the "minimum time" reference. Nothing outside this
 * file touches embind objects; every one created here is deleted again.
 */
import RuckigModuleFactory, { type EmbindObject, type RuckigModule, type RuckigVector } from './ruckig.js'
import type { Kinematic } from './control.js'

/** Plan to a target position (with a final velocity), or to a target velocity alone. */
export type RuckigInterface = 'position' | 'velocity'

export interface RuckigPlanInput {
  interface: RuckigInterface
  start: Kinematic
  target: Kinematic
  /** Limits; `Infinity` means unlimited. */
  maxVel: number
  maxAccel: number
  maxJerk: number
  /** Sample period of the returned trajectory (s). */
  dt: number
}

/** A sampled single-axis trajectory. */
export interface SampledTrajectory {
  time: Float64Array
  pos: Float64Array
  vel: Float64Array
  accel: Float64Array
  jerk: Float64Array
}

export type RuckigPlanResult = { ok: true; trajectory: SampledTrajectory } | { ok: false; code: number | null; message: string }

export interface RuckigLib {
  plan(input: RuckigPlanInput): RuckigPlanResult
}

/** Ruckig's `Result` codes that upstream reports by name. */
const ERROR_MESSAGES: ReadonlyMap<number, string> = new Map([
  [-100, 'Invalid input parameters.'],
  [-101, 'The trajectory duration exceeds its numerical limits.'],
  [-110, 'ErrorExecutionTimeCalculation.']
])

/**
 * `array_from_range` from upstream `Libraries/Array_Math.js`, including its accumulated step.
 * Throws a `RangeError` for a length `new Array` rejects, as upstream does.
 */
export function sampleTimes(start: number, end: number, step: number): Float64Array {
  const length = Math.floor((end - start) / step) + 1
  if (!Number.isInteger(length) || length < 0 || length > 2 ** 32 - 1) throw new RangeError('Invalid array length')
  const times = new Float64Array(length)
  let value = start
  for (let i = 0; i < length; i++) {
    times[i] = value
    value += step
  }
  return times
}

function createPlanner(module: RuckigModule): RuckigLib {
  return {
    plan(input) {
      const owned: EmbindObject[] = []
      const own = <T extends EmbindObject>(object: T): T => {
        owned.push(object)
        return object
      }
      const vector = (value: number): RuckigVector => {
        const v = own(new module.Vector())
        v.resize(1, 0)
        v.set(0, value)
        return v
      }
      /** Read element 0 of a vector-valued property, which embind returns as a fresh copy. */
      const first = (v: RuckigVector): number => {
        const value = v.get(0)
        v.delete()
        return value
      }

      try {
        const params = own(new module.InputParameter(1))
        params.current_position = vector(input.start.pos)
        params.current_velocity = vector(input.start.vel)
        params.current_acceleration = vector(input.start.accel)
        params.control_interface =
          input.interface === 'position' ? module.ControlInterface.Position : module.ControlInterface.Velocity
        params.target_position = vector(input.target.pos)
        params.target_velocity = vector(input.target.vel)
        params.target_acceleration = vector(input.target.accel)
        params.max_velocity = vector(input.maxVel)
        params.max_acceleration = vector(input.maxAccel)
        params.max_jerk = vector(input.maxJerk)

        const trajectory = own(new module.Trajectory(1))
        const result = own(new module.Ruckig(1)).calculate(params, trajectory)
        // Upstream reads `result.value` directly and throws for unregistered codes, which stops the
        // whole page updating; here they become an ordinary failure.
        if (result === undefined) {
          return { ok: false, code: null, message: 'Ruckig returned an unrecognised error, often because a limit is zero.' }
        }
        if (result.value !== 0) {
          return {
            ok: false,
            code: result.value,
            message: ERROR_MESSAGES.get(result.value) ?? `Unknown error (${result.value}).`
          }
        }

        let time: Float64Array
        try {
          time = sampleTimes(0, trajectory.get_duration(), input.dt)
        } catch {
          // Upstream throws here and the page stops updating.
          return { ok: false, code: null, message: 'The trajectory duration could not be sampled.' }
        }
        const pos = new Float64Array(time.length)
        const vel = new Float64Array(time.length)
        const accel = new Float64Array(time.length)
        const jerk = new Float64Array(time.length)
        for (let i = 0; i < time.length; i++) {
          const state = trajectory.at_time(time[i]!)
          pos[i] = first(state.position)
          vel[i] = first(state.velocity)
          accel[i] = first(state.acceleration)
          jerk[i] = first(state.jerk)
          state.delete()
        }
        return { ok: true, trajectory: { time, pos, vel, accel, jerk } }
      } finally {
        for (const object of owned) object.delete()
      }
    }
  }
}

/** Instantiate Ruckig from its wasm bytes (node) or by URL (browser). */
export async function instantiateRuckig(source: { bytes: Uint8Array } | { url: string }): Promise<RuckigLib> {
  const module = await RuckigModuleFactory('bytes' in source ? { wasmBinary: source.bytes } : { locateFile: () => source.url })
  return createPlanner(module)
}
