/**
 * The closed sets that define a simulation: vehicle, axis and command mode, plus the demand
 * (inputs and initial conditions) shared by both vehicles.
 */

export const VEHICLES = ['copter', 'plane'] as const
export type Vehicle = (typeof VEHICLES)[number]

export const COPTER_AXES = ['R', 'P', 'Y'] as const
export type CopterAxis = (typeof COPTER_AXES)[number]

/** Plane has no yaw attitude controller, so only roll and pitch. */
export const PLANE_AXES = ['R', 'P'] as const
export type PlaneAxis = (typeof PLANE_AXES)[number]

export const AXIS_NAMES: Readonly<Record<CopterAxis, string>> = { R: 'Roll', P: 'Pitch', Y: 'Yaw' }

export const COPTER_MODES = ['angle', 'rate', 'angle+rate'] as const
export type CopterMode = (typeof COPTER_MODES)[number]

/** Plane has no combined angle and rate command. */
export const PLANE_MODES = ['angle', 'rate'] as const
export type PlaneMode = (typeof PLANE_MODES)[number]

export const MODE_NAMES: Readonly<Record<CopterMode, string>> = { angle: 'Angle', rate: 'Rate', 'angle+rate': 'Angle + rate' }

/** Whether the mode commands an angle (upstream `use_pos`). */
export function usesAngle(mode: CopterMode): boolean {
  return mode !== 'rate'
}

/** Whether the mode commands a rate (upstream `use_vel`). */
export function usesRate(mode: CopterMode): boolean {
  return mode !== 'angle'
}

/** Pilot or navigation demand and the starting state, in degrees, degrees per second and seconds. */
export interface Demand {
  desiredAngle: number
  desiredRate: number
  /** Minimum simulated time; the run continues until both shapers settle, then 0.5 s more. */
  endTime: number
  initialAngle: number
  initialRate: number
}

export const DEFAULT_DEMAND: Demand = { desiredAngle: 30, desiredRate: 0, endTime: 1, initialAngle: 0, initialRate: 0 }

/** Limits of the end time input, as upstream. */
export const END_TIME_LIMITS = { min: 0.1, max: 10, step: 0.1 } as const
