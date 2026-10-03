/**
 * Types for the members of the Emscripten/embind Ruckig build (`ruckig.js`, kept verbatim from
 * upstream `KinematicTool/Ruckig/`) that `ruckig-planner.ts` uses. Only `ruckig-planner.ts`
 * imports this module.
 */

/** Every embind object owns C++ memory that `delete()` frees. */
export interface EmbindObject {
  delete(): void
}

/** `std::vector<double>`. */
export interface RuckigVector extends EmbindObject {
  resize(length: number, fill: number): void
  set(index: number, value: number): boolean
  get(index: number): number
}

/** An embind enum member. */
export interface EmbindEnumValue {
  readonly value: number
}

export interface RuckigInputParameter extends EmbindObject {
  current_position: RuckigVector
  current_velocity: RuckigVector
  current_acceleration: RuckigVector
  target_position: RuckigVector
  target_velocity: RuckigVector
  target_acceleration: RuckigVector
  max_velocity: RuckigVector
  max_acceleration: RuckigVector
  max_jerk: RuckigVector
  control_interface: EmbindEnumValue
}

export interface RuckigTrajectoryState extends EmbindObject {
  readonly position: RuckigVector
  readonly velocity: RuckigVector
  readonly acceleration: RuckigVector
  readonly jerk: RuckigVector
}

export interface RuckigTrajectory extends EmbindObject {
  get_duration(): number
  at_time(time: number): RuckigTrajectoryState
}

export interface RuckigCalculator extends EmbindObject {
  /**
   * The `Result` enum member, or `undefined` for codes the build does not register
   * (e.g. `ErrorTrajectoryDuration` -101 and `ErrorZeroLimits` -104).
   */
  calculate(input: RuckigInputParameter, trajectory: RuckigTrajectory): EmbindEnumValue | undefined
}

export interface RuckigModule {
  Vector: new () => RuckigVector
  InputParameter: new (degreesOfFreedom: number) => RuckigInputParameter
  Trajectory: new (degreesOfFreedom: number) => RuckigTrajectory
  Ruckig: new (degreesOfFreedom: number) => RuckigCalculator
  ControlInterface: { readonly Position: EmbindEnumValue; readonly Velocity: EmbindEnumValue }
}

export interface RuckigModuleOptions {
  /** The wasm bytes, when they are already in memory (tests in node). */
  wasmBinary?: ArrayBuffer | Uint8Array
  /** Resolve the URL of `ruckig.wasm` (the browser build passes the bundled asset URL). */
  locateFile?: (path: string, scriptDirectory: string) => string
}

declare function RuckigModuleFactory(options?: RuckigModuleOptions): Promise<RuckigModule>
export default RuckigModuleFactory
