// Applying and removing compass calibration parameters. Ported from upstream MAGFit/magfit.js
// (`scale_valid`, `apply_params`, and the calibration removal in `load`).

import { Matrix, inverse } from 'ml-matrix'
import { QUAT_IDENTITY, quatInverse, quatRotate } from './quaternion.js'
import { rotationQuat } from './rotations.js'
import type { CalParams, ExistingCompassParams } from './params.js'
import type { Vec3, Vec3Series } from './vector.js'

/** Scale factors outside [1/1.5, 1.5] are ignored by ArduPilot (upstream `scale_valid`). */
export function scaleValid(scale: number): boolean {
  const MAX_SCALE_FACTOR = 1.5
  return scale <= MAX_SCALE_FACTOR && scale >= 1 / MAX_SCALE_FACTOR
}

/** Symmetric soft-iron matrix from diagonals and off-diagonals (ArduPilot layout). */
export function ironMatrix(diagonals: Vec3, offDiagonals: Vec3): Matrix {
  return new Matrix([
    [diagonals[0], offDiagonals[0], offDiagonals[1]],
    [offDiagonals[0], diagonals[1], offDiagonals[2]],
    [offDiagonals[1], offDiagonals[2], diagonals[2]]
  ])
}

function allZero(v: Vec3): boolean {
  return v[0] === 0.0 && v[1] === 0.0 && v[2] === 0.0
}

function offset(a: Float64Array, o: number): Float64Array {
  const out = new Float64Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i]! + o
  return out
}

function scaled(a: Float64Array, s: number): Float64Array {
  const out = new Float64Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i]! * s
  return out
}

/** `(x * a + y * b) + z * c` per sample, the same evaluation order as upstream's array helpers. */
function combine(x: Float64Array, y: Float64Array, z: Float64Array, a: number, b: number, c: number): Float64Array {
  const out = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = x[i]! * a + y[i]! * b + z[i]! * c
  return out
}

/**
 * Apply calibration parameters to a raw field the way ArduPilot does: offsets, then scale
 * (if valid), then the iron matrix (unless all diagonals are zero), then motor compensation
 * `motor[i] * value` when an interference source is given (upstream `apply_params`).
 */
export function applyParams(
  raw: Vec3Series,
  params: Pick<CalParams, 'offsets' | 'scale' | 'diagonals' | 'offDiagonals' | 'motor'>,
  motorSource?: ArrayLike<number>
): Vec3Series {
  let x = offset(raw.x, params.offsets[0])
  let y = offset(raw.y, params.offsets[1])
  let z = offset(raw.z, params.offsets[2])

  if (scaleValid(params.scale)) {
    x = scaled(x, params.scale)
    y = scaled(y, params.scale)
    z = scaled(z, params.scale)
  }

  if (!allZero(params.diagonals)) {
    const d = params.diagonals
    const o = params.offDiagonals
    const cx = combine(x, y, z, d[0], o[0], o[1])
    const cy = combine(x, y, z, o[0], d[1], o[2])
    const cz = combine(x, y, z, o[1], o[2], d[2])
    x = cx
    y = cy
    z = cz
  }

  if (motorSource !== undefined) {
    const m = params.motor
    for (let i = 0; i < x.length; i++) {
      const v = motorSource[i]!
      x[i] = x[i]! + v * m[0]
      y[i] = y[i]! + v * m[1]
      z[i] = z[i]! + v * m[2]
    }
  }
  return { x, y, z }
}

/** Per-sample calibration state logged in each MAG message. */
export interface LoggedCorrections {
  /** Offsets in use (`OfsX/Y/Z`). */
  readonly offsets: Vec3Series
  /** Motor compensation applied (`MOX/Y/Z`). */
  readonly motor: Vec3Series
}

/** A compass field with the calibration removed. */
export interface RawField {
  /** Uncalibrated field, in the sensor frame when {@link rotated} is set. */
  readonly raw: Vec3Series
  /**
   * True when the board orientation was undone (external compass with a known rotation), so
   * the fit must re-apply and may re-check the orientation (upstream `MAG_Data[i].rotate`).
   */
  readonly rotated: boolean
}

/**
 * Undo the calibration ArduPilot applied to a logged field: subtract motor compensation, invert
 * the iron matrix, remove the scale, subtract the logged offsets and, for external compasses,
 * rotate back into the sensor frame (calibration removal in upstream `load`).
 */
export function removeCalibration(
  logged: Vec3Series,
  corrections: LoggedCorrections,
  params: Pick<ExistingCompassParams, 'diagonals' | 'offDiagonals' | 'scale' | 'external' | 'orientation'>
): RawField {
  const len = logged.x.length
  let x: Float64Array = new Float64Array(len)
  let y: Float64Array = new Float64Array(len)
  let z: Float64Array = new Float64Array(len)
  for (let i = 0; i < len; i++) {
    x[i] = logged.x[i]! - corrections.motor.x[i]!
    y[i] = logged.y[i]! - corrections.motor.y[i]!
    z[i] = logged.z[i]! - corrections.motor.z[i]!
  }

  // Remove iron correction. Upstream tests `array_all_equal(diagonals, 0.0)`, which is false
  // for missing (undefined) diagonals; building the matrix from `undefined` then throws in
  // ml-matrix ("Input data contains non-numeric values") and the load stops. When every
  // COMPASS_DIA*/ODI* parameter is absent (ArduPilot built without them applies no soft-iron
  // correction) the step is skipped: proven bug, fixed (docs/bug-proofs/magfit.md row 4). A
  // partial set still stops the load with upstream's error (missing values are NaN here, which
  // ml-matrix would accept, so it is thrown explicitly).
  const iron = [...params.diagonals, ...params.offDiagonals]
  if (!allZero(params.diagonals) && !iron.every(Number.isNaN)) {
    if (iron.some(Number.isNaN)) {
      throw new TypeError('Input data contains non-numeric values')
    }
    const inv = inverse(ironMatrix(params.diagonals, params.offDiagonals))
    const cx = combine(x, y, z, inv.get(0, 0), inv.get(0, 1), inv.get(0, 2))
    const cy = combine(x, y, z, inv.get(1, 0), inv.get(1, 1), inv.get(1, 2))
    const cz = combine(x, y, z, inv.get(2, 0), inv.get(2, 1), inv.get(2, 2))
    x = cx
    y = cy
    z = cz
  }

  // Remove scale factor, if valid
  if (scaleValid(params.scale)) {
    const invScale = 1 / params.scale
    x = scaled(x, invScale)
    y = scaled(y, invScale)
    z = scaled(z, invScale)
  }

  // remove offsets
  for (let i = 0; i < len; i++) {
    x[i] = x[i]! - corrections.offsets.x[i]!
    y[i] = y[i]! - corrections.offsets.y[i]!
    z[i] = z[i]! - corrections.offsets.z[i]!
  }

  // Rotate external compasses back into raw sensor frame
  const rotation = params.external !== 0 ? rotationQuat(params.orientation) : undefined
  if (rotation === undefined) return { raw: { x, y, z }, rotated: false }
  const inv = quatInverse(rotation)
  for (let j = 0; j < len; j++) {
    const tmp = quatRotate(inv, [x[j]!, y[j]!, z[j]!])
    x[j] = tmp[0]
    y[j] = tmp[1]
    z[j] = tmp[2]
  }
  return { raw: { x, y, z }, rotated: true }
}

/** Rotate every sample of a field by an ArduPilot rotation (upstream `MAG_Data[i].rotated`). */
export function rotateField(field: Vec3Series, rotation: number): Vec3Series {
  // Upstream ignores the result of from_rotation here, leaving the identity for unknown values.
  const q = rotationQuat(rotation) ?? QUAT_IDENTITY
  const len = field.x.length
  const x = new Float64Array(len)
  const y = new Float64Array(len)
  const z = new Float64Array(len)
  for (let j = 0; j < len; j++) {
    const tmp = quatRotate(q, [field.x[j]!, field.y[j]!, field.z[j]!])
    x[j] = tmp[0]
    y[j] = tmp[1]
    z[j] = tmp[2]
  }
  return { x, y, z }
}
