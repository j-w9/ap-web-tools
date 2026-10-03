/**
 * What the tool shows for a chosen rotation (upstream RotationCheck.js `update()`): its matrix,
 * its Euler angles and the rotated body axes, plus a reverse lookup from a matrix to the standard
 * rotations that produce it.
 */
import {
  matrixDistance,
  matrixFromEuler,
  matrixFromRotation,
  matrixToEuler,
  mulVector,
  type Matrix3,
  type Vector3
} from './matrix3.js'
import {
  EULER_AXES,
  STANDARD_ROTATIONS,
  type CustomRotationValue,
  type EulerAxis,
  type EulerDeg,
  type EulerRad,
  type StandardRotation,
  type StandardRotationValue
} from './rotations.js'

const DEG_TO_RAD = Math.PI / 180.0
const RAD_TO_DEG = 180.0 / Math.PI

export function eulerDegToRad(e: EulerDeg): EulerRad {
  return { roll: e.roll * DEG_TO_RAD, pitch: e.pitch * DEG_TO_RAD, yaw: e.yaw * DEG_TO_RAD }
}

export function eulerRadToDeg(e: EulerRad): EulerDeg {
  return { roll: e.roll * RAD_TO_DEG, pitch: e.pitch * RAD_TO_DEG, yaw: e.yaw * RAD_TO_DEG }
}

export type EulerParse =
  { readonly ok: true; readonly eulerDeg: EulerDeg } | { readonly ok: false; readonly invalid: readonly EulerAxis[] }

/**
 * Parse typed-in angles. Upstream passes the boxes through `parseFloat` and plots NaN when one is
 * empty; here an empty or non-numeric box is reported instead.
 */
export function parseEulerDeg(text: Readonly<Record<EulerAxis, string>>): EulerParse {
  const value = (axis: EulerAxis): number | null => {
    const t = text[axis].trim()
    const n = Number(t)
    return t === '' || !Number.isFinite(n) ? null : n
  }
  const roll = value('roll')
  const pitch = value('pitch')
  const yaw = value('yaw')
  if (roll === null || pitch === null || yaw === null) {
    return { ok: false, invalid: EULER_AXES.filter((axis) => value(axis) === null) }
  }
  return { ok: true, eulerDeg: { roll, pitch, yaw } }
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

/** Intrinsic 321 Euler angles recovered from a matrix, in degrees (upstream `to_euler`). */
export function recoveredEulerDeg(m: Matrix3): EulerDeg {
  return eulerRadToDeg(matrixToEuler(m))
}

/**
 * Default tolerance for matching a matrix to a standard rotation: the summed absolute difference
 * of all nine elements. Loose enough for angles typed to a tenth of a degree to miss, tight enough
 * that rounding in trigonometry does not.
 */
export const MATCH_TOLERANCE = 1e-6

/**
 * Standard rotations whose matrix equals `m`. Several Euler triples describe the same
 * orientation (roll 180 + pitch 180 is yaw 180), so this tells a user which enum value to set
 * for any angles they type. Not in upstream.
 */
export function findStandardRotations(m: Matrix3, tolerance: number = MATCH_TOLERANCE): StandardRotation[] {
  return STANDARD_ROTATIONS.filter((r) => matrixDistance(matrixFromRotation(r.id), m) <= tolerance)
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
