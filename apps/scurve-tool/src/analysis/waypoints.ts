/**
 * The four-waypoint mission the tool flies. Upstream: the "Position 1..4" fieldsets of
 * `SCurveTool/index.html`. Positions are entered North/East/Up in metres; ArduPilot's WPNav works
 * in NED, so `up` is negated on the way in (`d: -parseFloat(..._z)` upstream).
 */

/** A waypoint relative to the EKF origin, in metres. */
export interface Waypoint {
  readonly north: number
  readonly east: number
  readonly up: number
}

/** Always exactly four waypoints: start, destination, next and last. */
export type Mission = readonly [Waypoint, Waypoint, Waypoint, Waypoint]

export type WaypointIndex = 0 | 1 | 2 | 3

export type WaypointAxis = keyof Waypoint

export const WAYPOINT_INDICES = [0, 1, 2, 3] as const satisfies readonly WaypointIndex[]

interface WaypointInfo {
  readonly label: string
  readonly help: string
}

/** Label and tooltip of each waypoint, from upstream. */
export const WAYPOINT_INFO = [
  { label: 'Position 1', help: 'Waypoint that the vehicle is moving away from' },
  { label: 'Position 2', help: 'Waypoint that the vehicle is moving toward' },
  { label: 'Position 3', help: 'Next waypoint in mission sequence, after the current waypoint is achieved' },
  { label: 'Position 4', help: 'Last waypoint in mission sequence' }
] as const satisfies readonly [WaypointInfo, WaypointInfo, WaypointInfo, WaypointInfo]

/** Input limits upstream puts on each axis (`min`/`max`/`step` of the number fields). */
export const AXIS_INPUT = {
  north: { label: 'North (m)', min: -300, max: 300, step: 10 },
  east: { label: 'East (m)', min: -300, max: 300, step: 10 },
  up: { label: 'Up (m)', min: 0, max: 300, step: 10 }
} as const satisfies Record<WaypointAxis, { label: string; min: number; max: number; step: number }>

export const WAYPOINT_AXES = ['north', 'east', 'up'] as const satisfies readonly WaypointAxis[]

export const DEFAULT_MISSION: Mission = [
  { north: 0, east: 0, up: 300 },
  { north: 300, east: 300, up: 150 },
  { north: 70, east: 35, up: 80 },
  { north: 100, east: 250, up: 80 }
]

/** A copy of `mission` with one coordinate of one waypoint replaced. */
export function withWaypointValue(mission: Mission, index: WaypointIndex, axis: WaypointAxis, value: number): Mission {
  const next: [Waypoint, Waypoint, Waypoint, Waypoint] = [...mission]
  next[index] = { ...mission[index], [axis]: value }
  return next
}

/** A point in ArduPilot's NED frame, metres. */
export interface Ned {
  readonly north: number
  readonly east: number
  readonly down: number
}

export function toNed(w: Waypoint): Ned {
  return { north: w.north, east: w.east, down: -w.up }
}
