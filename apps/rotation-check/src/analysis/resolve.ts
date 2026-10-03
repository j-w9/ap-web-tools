/**
 * What the tool shows for a chosen rotation (upstream RotationCheck.js `update()`): its matrix,
 * its Euler angles and the rotated body axes.
 */
import { matrixFromEuler, matrixFromRotation, mulVector, type Matrix3, type Vector3 } from './matrix3.js'
import {
  STANDARD_ROTATIONS,
  type CustomRotationValue,
  type EulerAxis,
  type EulerDeg,
  type EulerRad,
  type StandardRotationValue
} from './rotations.js'

const DEG_TO_RAD = Math.PI / 180.0

export function eulerDegToRad(e: EulerDeg): EulerRad {
  return { roll: e.roll * DEG_TO_RAD, pitch: e.pitch * DEG_TO_RAD, yaw: e.yaw * DEG_TO_RAD }
}

/**
 * Read typed-in angles as upstream does: `parseFloat` of each box. An empty box gives NaN, which
 * upstream (and the port) carries into the matrix and the plot, so the rotated arrows vanish.
 */
export function parseEulerDeg(text: Readonly<Record<EulerAxis, string>>): EulerDeg {
  return { roll: Number.parseFloat(text.roll), pitch: Number.parseFloat(text.pitch), yaw: Number.parseFloat(text.yaw) }
}

/** A rotation the user has picked: a standard enum entry, or a custom one with typed-in angles. */
export type RotationChoice =
  | { readonly kind: 'standard'; readonly value: StandardRotationValue }
  | { readonly kind: 'custom'; readonly value: CustomRotationValue; readonly eulerDeg: EulerDeg }

export interface ResolvedRotation {
  readonly matrix: Matrix3
  /** The angles the rotation was defined by (the enum's angles, or the user's). */
  readonly eulerDeg: EulerDeg
}

export function resolveRotation(choice: RotationChoice): ResolvedRotation {
  switch (choice.kind) {
    case 'standard': {
      const row = STANDARD_ROTATIONS.find((r) => r.value === choice.value)
      if (row === undefined) throw new Error(`Unknown rotation ${choice.value}`)
      return { matrix: matrixFromRotation(row.id), eulerDeg: row.eulerDeg }
    }
    case 'custom':
      return { matrix: matrixFromEuler(eulerDegToRad(choice.eulerDeg)), eulerDeg: choice.eulerDeg }
  }
}

export const BODY_AXES = ['x', 'y', 'z'] as const
export type BodyAxis = (typeof BODY_AXES)[number]

/** Length of the reference frame's axes in the plot (upstream `origin_size`). */
export const ORIGIN_SIZE = 0.2
/** The rotated frame is drawn 1.5 times longer so it stands out from the reference. */
export const ROTATED_AXIS_LENGTH = ORIGIN_SIZE * 1.5

const UNIT: Readonly<Record<BodyAxis, Vector3>> = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 }
}

/** A body axis of the given length expressed in the reference frame, i.e. `m · (length · e)`. */
export function rotatedAxis(m: Matrix3, axis: BodyAxis, length: number): Vector3 {
  const u = UNIT[axis]
  return mulVector(m, { x: u.x * length, y: u.y * length, z: u.z * length })
}
