/**
 * Types for the Emscripten glue `wpnav-glue.js`: upstream `SCurveTool/ardupilot/wpnav.js` with its
 * content kept verbatim, renamed so Vite does not resolve imports of `./wpnav.js` (meaning
 * `wpnav.ts`) to it. Built with `-s MODULARIZE=1 -s EXPORT_NAME='WPNavModule' --bind`, it is a
 * classic script that defines the factory as the global `WPNavModule`; it is never imported as a module, so this file
 * only declares types (import them with `import type ... from './wpnav-glue.js'`). Only the
 * members this app uses are declared; the embind class mirrors `EMSCRIPTEN_BINDINGS` in upstream
 * `bindings.cpp`.
 */

/** `emscripten::val` array of three floats, `[x, y, z]`. */
export type BoundVec3 = [number, number, number]

/** The object `get_current_1D_curve` builds: parallel plain arrays. */
export interface BoundCurve {
  time: number[]
  pos: number[]
  vel: number[]
  accel: number[]
  jerk: number[]
  snap: number[]
}

/** An `AC_WPNav_wrapper` living on the wasm heap. Must be `delete()`d. */
export interface AC_WPNav_wrapper {
  wp_and_spline_init_m(n: number, e: number, d: number): void
  set_wp_destination_NED_m(n: number, e: number, d: number): boolean
  set_wp_destination_next_NED_m(n: number, e: number, d: number): boolean
  advance_wp_target_along_track(dt: number): boolean
  reached_wp_destination(): boolean
  set_initial_position(n: number, e: number, d: number): void
  set_wp_nav_params(
    speed_ms: number,
    speed_up_ms: number,
    speed_down_ms: number,
    radius_m: number,
    accel_mss: number,
    accel_c_mss: number,
    accel_z_mss: number,
    jerk_msss: number,
    terrain_margin_m: number
  ): void
  set_psc_params(
    xy_kp: number,
    accel_z_filt_t: number,
    accel_z_filt_e: number,
    shaping_jerk_ne_msss: number,
    shaping_jerk_d_msss: number,
    dt_s: number
  ): void
  set_atc_params(
    ang_vel_roll_max_degs: number,
    ang_vel_pitch_max_degs: number,
    accel_roll_max_degss: number,
    accel_pitch_max_degss: number,
    input_tc: number,
    rate_bf_ff_enabled: boolean
  ): void
  get_pos(): BoundVec3
  get_vel(): BoundVec3
  get_accel(): BoundVec3
  get_current_1D_curve(dt: number): BoundCurve
  /** Free the C++ object (embind). */
  delete(): void
  isDeleted(): boolean
}

/** The instantiated module. */
export interface WPNavModuleInstance {
  AC_WPNav_wrapper: new () => AC_WPNav_wrapper
}

/** Options the factory reads (`Module['locateFile']`, `Module['wasmBinary']`). */
export interface WPNavModuleOptions {
  locateFile?: (path: string, scriptDirectory: string) => string
  wasmBinary?: ArrayBuffer | Uint8Array
}

export type WPNavModuleFactory = (options?: WPNavModuleOptions) => Promise<WPNavModuleInstance>

declare global {
  interface Window {
    /** Defined by `wpnav-glue.js` when loaded as a classic script. */
    WPNavModule?: WPNavModuleFactory
  }
}
