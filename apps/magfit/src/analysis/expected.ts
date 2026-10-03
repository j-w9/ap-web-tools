// Expected body-frame field and compass heading. Ported from upstream MAGFit/magfit.js
// (`array_slerp` inside `select_body_frame_attitude`, `get_body_frame_ef`, `get_yaw`).

import { wrap2Pi, arrayWrapPi } from './angles.js'
import { quatAt, quatPitch, quatRoll, quatRotate, quatYaw, slerp, type QuatSeries } from './quaternion.js'
import type { Vec3, Vec3Series } from './vector.js'

/** Allocate an empty quaternion series. */
function quatSeries(length: number): { q1: Float64Array; q2: Float64Array; q3: Float64Array; q4: Float64Array } {
  return {
    q1: new Float64Array(length),
    q2: new Float64Array(length),
    q3: new Float64Array(length),
    q4: new Float64Array(length)
  }
}

/**
 * Spherically interpolate a quaternion series sampled at ascending `index` onto `queryIndex`
 * (also ascending), clamping to the end values (upstream `array_slerp`).
 */
export function interpolateAttitude(values: QuatSeries, index: ArrayLike<number>, queryIndex: ArrayLike<number>): QuatSeries {
  const len = queryIndex.length
  const ret = quatSeries(len)
  const set = (i: number, q: { q1: number; q2: number; q3: number; q4: number }): void => {
    ret.q1[i] = q.q1
    ret.q2[i] = q.q2
    ret.q3[i] = q.q3
    ret.q4[i] = q.q4
  }

  const lastValueIndex = index.length - 1
  let interpolateIndex = 0
  for (let i = 0; i < len; i++) {
    const query = queryIndex[i]!
    if (query <= index[0]!) {
      set(i, quatAt(values, 0))
      continue
    }
    if (query >= index[lastValueIndex]!) {
      set(i, quatAt(values, lastValueIndex))
      continue
    }
    // increment index until there is a point after the target
    for (; interpolateIndex < lastValueIndex; interpolateIndex++) {
      if (query < index[interpolateIndex + 1]!) {
        const ratio = (query - index[interpolateIndex]!) / (index[interpolateIndex + 1]! - index[interpolateIndex]!)
        set(i, slerp(quatAt(values, interpolateIndex), quatAt(values, interpolateIndex + 1), ratio))
        break
      }
    }
  }
  return ret
}

/** Euler yaw of every quaternion in a series, radians (upstream `MAG_Data[i].quaternion.yaw`). */
export function attitudeYaw(q: QuatSeries): Float64Array {
  const len = q.q1.length
  const out = new Float64Array(len)
  for (let i = 0; i < len; i++) out[i] = quatYaw(quatAt(q, i))
  return out
}

/**
 * Rotate the earth-frame field vector into the body frame for each attitude sample
 * (upstream `get_body_frame_ef`).
 */
export function bodyFrameEarthField(q: QuatSeries, earthFieldVector: Vec3): Vec3Series {
  const len = q.q1.length
  const x = new Float64Array(len)
  const y = new Float64Array(len)
  const z = new Float64Array(len)
  for (let i = 0; i < len; i++) {
    // Invert and rotate
    const tmp = quatRotate({ q1: q.q1[i]!, q2: -q.q2[i]!, q3: -q.q3[i]!, q4: -q.q4[i]! }, earthFieldVector)
    x[i] = tmp[0]
    y[i] = tmp[1]
    z[i] = tmp[2]
  }
  return { x, y, z }
}

/**
 * Tilt-compensated heading from a body-frame field using roll and pitch from the attitude,
 * corrected for declination, radians in [0, 2pi) (upstream `get_yaw`).
 */
export function compassYaw(field: Vec3Series, q: QuatSeries, declinationDeg: number): Float64Array {
  const len = field.x.length
  const declinationRad = declinationDeg * (Math.PI / 180)
  const yaw = new Float64Array(len)
  for (let i = 0; i < len; i++) {
    const quat = quatAt(q, i)
    const roll = quatRoll(quat)
    const pitch = quatPitch(quat)

    const cp = Math.cos(pitch)
    const sp = Math.sin(pitch)
    const sr = Math.sin(roll)
    const cr = Math.cos(roll)

    const X = cp * field.x[i]! + sr * sp * field.y[i]! + cr * sp * field.z[i]!
    const Y = -1.0 * cr * field.y[i]! + sr * field.z[i]!

    yaw[i] = wrap2Pi(Math.atan2(Y, X) + declinationRad)
  }
  return yaw
}

/** Heading difference `a - b` wrapped to (-180, 180] degrees (upstream yaw change plots). */
export function yawChangeDeg(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const len = a.length
  const diff = new Float64Array(len)
  for (let i = 0; i < len; i++) diff[i] = a[i]! - b[i]!
  const wrapped = arrayWrapPi(diff)
  const scale = 180 / Math.PI
  for (let i = 0; i < len; i++) wrapped[i] = wrapped[i]! * scale
  return wrapped
}
