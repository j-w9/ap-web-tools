/**
 * What the simulation needs from ArduPilot's waypoint navigation. The real implementation is
 * AC_WPNav compiled to WebAssembly (`src/wasm/wpnav.ts`); keeping the interface here leaves the
 * sampling loop pure and testable.
 *
 * Upstream: the `AC_WPNav_wrapper` embind class in `SCurveTool/ardupilot/bindings.cpp`.
 */
import type { Ned } from './waypoints.js'

/** A vector in NED order, `[north, east, down]`. */
export type Vec3 = readonly [north: number, east: number, down: number]

/** `AC_WPNav` limits (`WP_*` parameters). */
export interface WpNavLimits {
  readonly speedMs: number
  readonly speedUpMs: number
  readonly speedDownMs: number
  readonly radiusM: number
  readonly accelMss: number
  readonly accelCornerMss: number
  readonly accelZMss: number
  readonly jerkMsss: number
  readonly terrainMarginM: number
}

/** `AC_PosControl` settings (`PSC_*` parameters) and the loop period. */
export interface PosControlSettings {
  readonly neKp: number
  readonly accelZFilterTargetHz: number
  readonly accelZFilterErrorHz: number
  readonly shapingJerkNeMsss: number
  readonly shapingJerkDMsss: number
  readonly dtS: number
}

/** `AC_AttitudeControl` settings (`ATC_*` parameters). */
export interface AttitudeSettings {
  readonly rollRateMaxDegs: number
  readonly pitchRateMaxDegs: number
  readonly rollAccelMaxDegss: number
  readonly pitchAccelMaxDegss: number
  readonly inputTc: number
  readonly rateFeedForward: boolean
}

/** The kinematic quantities of a 1D S-curve, in the order they are plotted. */
export const CURVE_KEYS = ['pos', 'vel', 'accel', 'jerk', 'snap'] as const
export type CurveKey = (typeof CURVE_KEYS)[number]

/** One leg's 1D S-curve sampled along its track, time from the start of the leg. */
export type Curve1D = { readonly time: Float64Array } & { readonly [K in CurveKey]: Float64Array }

/** One live `AC_WPNav` instance. Borrowed: the engine owns and frees it. */
export interface WpNav {
  setLimits(limits: WpNavLimits): void
  setPosControl(settings: PosControlSettings): void
  setAttitude(settings: AttitudeSettings): void
  /** Place the position controller at `pos`, at rest. */
  setInitialPosition(pos: Ned): void
  /** `wp_and_spline_init_m` from a stopping point. */
  init(stoppingPoint: Ned): void
  setDestination(destination: Ned): boolean
  setNextDestination(destination: Ned): boolean
  /** `advance_wp_target_along_track`. */
  advance(dtS: number): boolean
  reachedDestination(): boolean
  /** Position estimate, metres NED. */
  position(): Vec3
  /** Desired velocity, m/s NED. */
  velocity(): Vec3
  /** Desired acceleration, m/s² NED. */
  acceleration(): Vec3
  /** The current leg's S-curve sampled every `dtS` from 0 to its end. */
  currentCurve(dtS: number): Curve1D
}

/** Creates `WpNav` instances and frees each one when `body` returns or throws. */
export interface WpNavEngine {
  withWpNav<T>(body: (nav: WpNav) => T): T
}
