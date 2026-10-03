// Quaternion helpers, ported from upstream MAGFit/quaternion.js (`Quaternion`, `slerp`).
// Upstream uses a mutable object; here quaternions are immutable plain values.

import type { Vec3 } from './vector.js'

/** A rotation quaternion with ArduPilot's naming: `q1` is the scalar part. */
export interface Quat {
  readonly q1: number
  readonly q2: number
  readonly q3: number
  readonly q4: number
}

/** A time series of quaternions stored as one column per component. */
export interface QuatSeries {
  readonly q1: Float64Array
  readonly q2: Float64Array
  readonly q3: Float64Array
  readonly q4: Float64Array
}

/** The identity rotation. */
export const QUAT_IDENTITY: Quat = { q1: 1, q2: 0, q3: 0, q4: 0 }

/** Quaternion number `i` of a series. */
export function quatAt(series: QuatSeries, i: number): Quat {
  return { q1: series.q1[i]!, q2: series.q2[i]!, q3: series.q3[i]!, q4: series.q4[i]! }
}

/** Conjugate (inverse for a unit quaternion), upstream `Quaternion.invert`. */
export function quatInverse(q: Quat): Quat {
  return { q1: q.q1, q2: -q.q2, q3: -q.q3, q4: -q.q4 }
}

/** Rotate a vector by a quaternion (upstream `Quaternion.rotate`). */
export function quatRotate(q: Quat, vec: Vec3): [number, number, number] {
  const uv0 = (q.q3 * vec[2] - q.q4 * vec[1]) * 2.0
  const uv1 = (q.q4 * vec[0] - q.q2 * vec[2]) * 2.0
  const uv2 = (q.q2 * vec[1] - q.q3 * vec[0]) * 2.0
  return [
    vec[0] + (q.q1 * uv0 + q.q3 * uv2 - q.q4 * uv1),
    vec[1] + (q.q1 * uv1 + q.q4 * uv0 - q.q2 * uv2),
    vec[2] + (q.q1 * uv2 + q.q2 * uv1 - q.q3 * uv0)
  ]
}

/** Quaternion from 321 Euler angles in radians (upstream `Quaternion.from_euler`). */
export function quatFromEuler(roll: number, pitch: number, yaw: number): Quat {
  const cr2 = Math.cos(roll * 0.5)
  const cp2 = Math.cos(pitch * 0.5)
  const cy2 = Math.cos(yaw * 0.5)
  const sr2 = Math.sin(roll * 0.5)
  const sp2 = Math.sin(pitch * 0.5)
  const sy2 = Math.sin(yaw * 0.5)
  return {
    q1: cr2 * cp2 * cy2 + sr2 * sp2 * sy2,
    q2: sr2 * cp2 * cy2 - cr2 * sp2 * sy2,
    q3: cr2 * sp2 * cy2 + sr2 * cp2 * sy2,
    q4: cr2 * cp2 * sy2 - sr2 * sp2 * cy2
  }
}

/** Euler roll angle in radians (upstream `get_euler_roll`). */
export function quatRoll(q: Quat): number {
  return Math.atan2(2.0 * (q.q1 * q.q2 + q.q3 * q.q4), 1.0 - 2.0 * (q.q2 * q.q2 + q.q3 * q.q3))
}

/** Euler pitch angle in radians (upstream `get_euler_pitch`). */
export function quatPitch(q: Quat): number {
  return Math.asin(2.0 * (q.q1 * q.q3 - q.q4 * q.q2))
}

/** Euler yaw angle in radians (upstream `get_euler_yaw`). */
export function quatYaw(q: Quat): number {
  return Math.atan2(2.0 * (q.q1 * q.q4 + q.q2 * q.q3), 1.0 - 2.0 * (q.q3 * q.q3 + q.q4 * q.q4))
}

/** Spherical linear interpolation from `a` (t = 0) to `c` (t = 1), upstream `slerp`. */
export function slerp(a: Quat, c: Quat, t: number): Quat {
  let dotProd = a.q1 * c.q1 + a.q2 * c.q2 + a.q3 * c.q3 + a.q4 * c.q4

  let cSign = 1.0
  if (dotProd < 0) {
    cSign = -1.0
    dotProd *= -1.0
  }
  if (dotProd >= 1.0) {
    // a and c are the same, return copy of a
    return { q1: a.q1, q2: a.q2, q3: a.q3, q4: a.q4 }
  }

  const theta0 = Math.acos(dotProd)
  const sinTheta0Inv = 1 / Math.sin(theta0)

  const aScale = Math.sin((1.0 - t) * theta0) * sinTheta0Inv
  const cScale = Math.sin(t * theta0) * cSign * sinTheta0Inv

  return {
    q1: a.q1 * aScale + c.q1 * cScale,
    q2: a.q2 * aScale + c.q2 * cScale,
    q3: a.q3 * aScale + c.q3 * cScale,
    q4: a.q4 * aScale + c.q4 * cScale
  }
}
