/**
 * Typed access to the ArduPilot `AP_Math/control.cpp` shaping functions, compiled to WebAssembly
 * from `bindings.cpp` (see `WASM.md`). The module has no imports, so it is instantiated directly
 * rather than through the Emscripten glue upstream ships (`ardupilot/control.js`).
 *
 * All arguments are `float` in C++, so values are rounded to single precision at the boundary,
 * exactly as they are when upstream calls the same exports through the glue.
 */

/** One kinematic state: position (or angle), its rate and its acceleration. */
export interface Kinematic {
  pos: number
  vel: number
  accel: number
}

/** Arguments of `shape_angle_vel_accel`: shape `current` towards `desired` within limits. */
export interface ShapeAngleInput {
  desired: Kinematic
  current: Kinematic
  velMin: number
  velMax: number
  accelMax: number
  jerkMax: number
  dt: number
  limitTotal: boolean
}

/** Arguments of `shape_pos_vel_accel`, which also takes a separate lower acceleration limit. */
export interface ShapePosInput extends ShapeAngleInput {
  accelMin: number
}

/** Arguments of `sqrt_controller`. */
export interface SqrtControllerInput {
  error: number
  p: number
  secondOrderLimit: number
  dt: number
}

export interface ControlLib {
  /** `shape_angle_vel_accel`; returns the new shaped acceleration. */
  shapeAngleVelAccel(input: ShapeAngleInput): number
  /** `shape_pos_vel_accel`; returns the new shaped acceleration. */
  shapePosVelAccel(input: ShapePosInput): number
  /** `sqrt_controller`; returns the correction for `error`. */
  sqrtController(input: SqrtControllerInput): number
}

type WasmFunction = (...args: number[]) => number

function exportedFunction(exports: WebAssembly.Exports, name: string): WasmFunction {
  const fn = exports[name]
  if (typeof fn !== 'function') throw new Error(`control.wasm does not export ${name}`)
  // WebAssembly exports are typed as `Function`; these take and return numbers only.
  return fn as WasmFunction
}

/** Instantiate `control.wasm` from its bytes. */
export async function instantiateControl(bytes: BufferSource): Promise<ControlLib> {
  const { instance } = await WebAssembly.instantiate(bytes, {})
  const exports = instance.exports
  exportedFunction(exports, 'emscripten_stack_init')()
  exportedFunction(exports, '__wasm_call_ctors')()

  const shapeAngle = exportedFunction(exports, 'shape_angle_vel_accel_wrapper')
  const shapePos = exportedFunction(exports, 'shape_pos_vel_accel_wrapper')
  const sqrt = exportedFunction(exports, 'sqrt_controller_wrapper')

  return {
    shapeAngleVelAccel: (i) =>
      shapeAngle(
        i.desired.pos,
        i.desired.vel,
        i.desired.accel,
        i.current.pos,
        i.current.vel,
        i.current.accel,
        i.velMin,
        i.velMax,
        i.accelMax,
        i.jerkMax,
        i.dt,
        i.limitTotal ? 1 : 0
      ),
    shapePosVelAccel: (i) =>
      shapePos(
        i.desired.pos,
        i.desired.vel,
        i.desired.accel,
        i.current.pos,
        i.current.vel,
        i.current.accel,
        i.velMin,
        i.velMax,
        i.accelMin,
        i.accelMax,
        i.jerkMax,
        i.dt,
        i.limitTotal ? 1 : 0
      ),
    sqrtController: (i) => sqrt(i.error, i.p, i.secondOrderLimit, i.dt)
  }
}
