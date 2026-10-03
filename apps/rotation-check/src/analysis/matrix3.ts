/**
 * Port of upstream RotationCheck/Matrix3.js (itself a port of AP_Math's Matrix3 and
 * rotations). Upstream mutates a `Matrix3` object; here matrices are immutable values and each
 * upstream method is a pure function. The arithmetic is kept in upstream's order so results are
 * bit-identical.
 */
import { STANDARD_ROTATIONS, type EulerRad, type StandardRotationId, type StandardRotationValue } from './rotations.js'

export interface Vector3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** Row-major 3x3 matrix: `a`, `b`, `c` are rows, as in AP_Math. */
export interface Matrix3 {
  readonly a: Vector3
  readonly b: Vector3
  readonly c: Vector3
}

export const IDENTITY: Matrix3 = {
  a: { x: 1, y: 0, z: 0 },
  b: { x: 0, y: 1, z: 0 },
  c: { x: 0, y: 0, z: 1 }
}

// Upstream writes 0.70710678118654752440084436210485, which parses to exactly this double.
const HALF_SQRT_2 = Math.SQRT1_2

/** `asin` clamped to ±π/2 outside [-1, 1] (upstream `safe_asin`). */
export function safeAsin(f: number): number {
  if (f >= 1.0) return Math.PI * 0.5
  if (f <= -1.0) return -Math.PI * 0.5
  return Math.asin(f)
}

/**
 * Rotate a vector by a standard rotation (upstream `rotate(rotation, v)`, AP_Math
 * `Vector3::rotate`). Upstream returns undefined for custom and out-of-range values; the type of
 * `rotation` rules those out here.
 */
export function rotateVector(rotation: StandardRotationId, v: Vector3): Vector3 {
  let { x, y, z } = v
  let tmp: number
  switch (rotation) {
    case 'NONE':
      return { x, y, z }
    case 'YAW_45':
      tmp = HALF_SQRT_2 * (x - y)
      y = HALF_SQRT_2 * (x + y)
      x = tmp
      return { x, y, z }
    case 'YAW_90':
      tmp = x
      x = -y
      y = tmp
      return { x, y, z }
    case 'YAW_135':
      tmp = -HALF_SQRT_2 * (x + y)
      y = HALF_SQRT_2 * (x - y)
      x = tmp
      return { x, y, z }
    case 'YAW_180':
      return { x: -x, y: -y, z }
    case 'YAW_225':
      tmp = HALF_SQRT_2 * (y - x)
      y = -HALF_SQRT_2 * (x + y)
      x = tmp
      return { x, y, z }
    case 'YAW_270':
      tmp = x
      x = y
      y = -tmp
      return { x, y, z }
    case 'YAW_315':
      tmp = HALF_SQRT_2 * (x + y)
      y = HALF_SQRT_2 * (y - x)
      x = tmp
      return { x, y, z }
    case 'ROLL_180':
      return { x, y: -y, z: -z }
    case 'ROLL_180_YAW_45':
      tmp = HALF_SQRT_2 * (x + y)
      y = HALF_SQRT_2 * (x - y)
      return { x: tmp, y, z: -z }
    case 'ROLL_180_YAW_90':
    case 'PITCH_180_YAW_270':
      return { x: y, y: x, z: -z }
    case 'ROLL_180_YAW_135':
      tmp = HALF_SQRT_2 * (y - x)
      y = HALF_SQRT_2 * (y + x)
      return { x: tmp, y, z: -z }
    case 'PITCH_180':
      return { x: -x, y, z: -z }
    case 'ROLL_180_YAW_225':
      tmp = -HALF_SQRT_2 * (x + y)
      y = HALF_SQRT_2 * (y - x)
      return { x: tmp, y, z: -z }
    case 'ROLL_180_YAW_270':
    case 'PITCH_180_YAW_90':
      return { x: -y, y: -x, z: -z }
    case 'ROLL_180_YAW_315':
      tmp = HALF_SQRT_2 * (x - y)
      y = -HALF_SQRT_2 * (x + y)
      return { x: tmp, y, z: -z }
    case 'ROLL_90':
      return roll90(v)
    case 'ROLL_90_YAW_45':
      return rotateVector('YAW_45', roll90(v))
    case 'ROLL_90_YAW_90':
      return rotateVector('YAW_90', roll90(v))
    case 'ROLL_90_YAW_135':
      return rotateVector('YAW_135', roll90(v))
    case 'ROLL_270':
      return roll270(v)
    case 'ROLL_270_YAW_45':
      return rotateVector('YAW_45', roll270(v))
    case 'ROLL_270_YAW_90':
      return rotateVector('YAW_90', roll270(v))
    case 'ROLL_270_YAW_135':
      return rotateVector('YAW_135', roll270(v))
    case 'PITCH_90':
      return pitch90(v)
    case 'PITCH_270':
      return pitch270(v)
    case 'ROLL_90_PITCH_90':
      return pitch90(roll90(v))
    case 'ROLL_180_PITCH_90':
      return pitch90(rotateVector('ROLL_180', v))
    case 'ROLL_270_PITCH_90':
      return pitch90(roll270(v))
    case 'ROLL_90_PITCH_180':
      return rotateVector('PITCH_180', roll90(v))
    case 'ROLL_270_PITCH_180':
      return rotateVector('PITCH_180', roll270(v))
    case 'ROLL_90_PITCH_270':
      return pitch270(roll90(v))
    case 'ROLL_180_PITCH_270':
      return pitch270(rotateVector('ROLL_180', v))
    case 'ROLL_270_PITCH_270':
      return pitch270(roll270(v))
    case 'ROLL_90_PITCH_180_YAW_90':
      return rotateVector('YAW_90', rotateVector('PITCH_180', roll90(v)))
    case 'ROLL_90_YAW_270':
      return rotateVector('YAW_270', roll90(v))
    case 'ROLL_90_PITCH_68_YAW_293':
      return {
        x:
          0.14303897231223747232853327204793 * x +
          0.36877648650320382639478111741482 * y +
          -0.91844638134308709265241077446262 * z,
        y:
          -0.33213277779664740485543461545603 * x +
          -0.85628942146641884303193137384369 * y +
          -0.39554550256296522325882847326284 * z,
        z:
          -0.93232380121551217122544130688766 * x +
          0.36162457008209242248497616856184 * y +
          0.00000000000000002214311861220361 * z
      }
    case 'PITCH_315':
      tmp = HALF_SQRT_2 * (x - z)
      z = HALF_SQRT_2 * (x + z)
      return { x: tmp, y, z }
    case 'ROLL_90_PITCH_315':
      return rotateVector('PITCH_315', roll90(v))
    case 'PITCH_7': {
      const sinPitch = 0.1218693434051474899781908334262
      const cosPitch = 0.99254615164132198312785249072476
      return { x: cosPitch * x + sinPitch * z, y, z: -sinPitch * x + cosPitch * z }
    }
    case 'ROLL_45':
      tmp = HALF_SQRT_2 * (y - z)
      z = HALF_SQRT_2 * (y + z)
      return { x, y: tmp, z }
    case 'ROLL_315':
      tmp = HALF_SQRT_2 * (y + z)
      z = HALF_SQRT_2 * (z - y)
      return { x, y: tmp, z }
  }
}

// Building blocks upstream inlines into the combined cases; the sequence of operations is the same.
function roll90({ x, y, z }: Vector3): Vector3 {
  return { x, y: -z, z: y }
}
function roll270({ x, y, z }: Vector3): Vector3 {
  return { x, y: z, z: -y }
}
function pitch90({ x, y, z }: Vector3): Vector3 {
  return { x: z, y, z: -x }
}
function pitch270({ x, y, z }: Vector3): Vector3 {
  return { x: -z, y, z: x }
}

/** Upstream `from_euler(roll, pitch, yaw)`: rotation matrix from intrinsic 321 Euler angles. */
export function matrixFromEuler({ roll, pitch, yaw }: EulerRad): Matrix3 {
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const sr = Math.sin(roll)
  const cr = Math.cos(roll)
  const sy = Math.sin(yaw)
  const cy = Math.cos(yaw)
  return {
    a: { x: cp * cy, y: sr * sp * cy - cr * sy, z: cr * sp * cy + sr * sy },
    b: { x: cp * sy, y: sr * sp * sy + cr * cy, z: cr * sp * sy - sr * cy },
    c: { x: -sp, y: sr * cp, z: cr * cp }
  }
}

/** Upstream `to_euler()`: intrinsic 321 Euler angles of a rotation matrix. */
export function matrixToEuler(m: Matrix3): EulerRad {
  return {
    roll: Math.atan2(m.c.y, m.c.z),
    pitch: -safeAsin(m.c.x),
    yaw: Math.atan2(m.b.x, m.a.x)
  }
}

/** Upstream `from_rotation(rotation)`: the matrix of a standard rotation, built column by column. */
export function matrixFromRotation(rotation: StandardRotationId): Matrix3 {
  const a = rotateVector(rotation, { x: 1.0, y: 0.0, z: 0.0 })
  const b = rotateVector(rotation, { x: 0.0, y: 1.0, z: 0.0 })
  const c = rotateVector(rotation, { x: 0.0, y: 0.0, z: 1.0 })
  return {
    a: { x: a.x, y: b.x, z: c.x },
    b: { x: a.y, y: b.y, z: c.y },
    c: { x: a.z, y: b.z, z: c.z }
  }
}

/** `matrixFromRotation` by enum value. */
export function matrixFromRotationValue(value: StandardRotationValue): Matrix3 {
  const row = STANDARD_ROTATIONS.find((r) => r.value === value)
  if (row === undefined) throw new Error(`Unknown rotation ${value}`)
  return matrixFromRotation(row.id)
}

/** Upstream `to_euler312()`: 312 Euler angles (roll, pitch, yaw) of a rotation matrix. */
export function matrixToEuler312(m: Matrix3): EulerRad {
  return {
    roll: safeAsin(m.c.y),
    pitch: Math.atan2(-m.c.x, m.c.z),
    yaw: Math.atan2(-m.a.y, m.b.y)
  }
}

/** Upstream `from_euler312(roll, pitch, yaw)`. */
export function matrixFromEuler312({ roll, pitch, yaw }: EulerRad): Matrix3 {
  const c3 = Math.cos(pitch)
  const s3 = Math.sin(pitch)
  const s2 = Math.sin(roll)
  const c2 = Math.cos(roll)
  const s1 = Math.sin(yaw)
  const c1 = Math.cos(yaw)
  return {
    a: { x: c1 * c3 - s1 * s2 * s3, y: -c2 * s1, z: s3 * c1 + c3 * s2 * s1 },
    b: { x: c3 * s1 + s3 * s2 * c1, y: c1 * c2, z: s1 * s3 - s2 * c1 * c3 },
    c: { x: -s3 * c2, y: s2, z: c3 * c2 }
  }
}

/** Upstream `rotate(v)`: matrix times column vector. */
export function mulVector(m: Matrix3, v: Vector3): Vector3 {
  return {
    x: m.a.x * v.x + m.a.y * v.y + m.a.z * v.z,
    y: m.b.x * v.x + m.b.y * v.y + m.b.z * v.z,
    z: m.c.x * v.x + m.c.y * v.y + m.c.z * v.z
  }
}

/** Sum of absolute element differences, the measure upstream's start-up check uses. */
export function matrixDistance(m: Matrix3, n: Matrix3): number {
  let diff = 0
  for (const row of ['a', 'b', 'c'] as const) {
    for (const axis of ['x', 'y', 'z'] as const) {
      diff += Math.abs(m[row][axis] - n[row][axis])
    }
  }
  return diff
}
