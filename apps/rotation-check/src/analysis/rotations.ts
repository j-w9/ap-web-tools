/**
 * ArduPilot's `enum Rotation` (libraries/AP_Math/rotations.h), as used by AHRS_ORIENTATION,
 * COMPASS_ORIENT, INS_ACC_ROT and friends.
 *
 * `id` is the C enum name without the `ROTATION_` prefix (upstream Matrix3.js constants), `name`
 * is the parameter-description label (upstream index.html `Rotations`). `eulerDeg` holds the
 * intrinsic 321 Euler angles of each rotation. Upstream parses them out of `name` at load time;
 * here they are written out and the oracle test checks them against that parsing.
 */

/** Euler angles in degrees, intrinsic 321 (yaw, then pitch, then roll). */
export interface EulerDeg {
  readonly roll: number
  readonly pitch: number
  readonly yaw: number
}

/** Euler angles in radians, intrinsic 321 (yaw, then pitch, then roll). */
export interface EulerRad {
  readonly roll: number
  readonly pitch: number
  readonly yaw: number
}

export const EULER_AXES = ['roll', 'pitch', 'yaw'] as const
export type EulerAxis = (typeof EULER_AXES)[number]

interface StandardRotationRow {
  readonly value: number
  readonly id: string
  readonly name: string
  readonly eulerDeg: EulerDeg
}

export const STANDARD_ROTATIONS = [
  { value: 0, id: 'NONE', name: 'None', eulerDeg: { roll: 0, pitch: 0, yaw: 0 } },
  { value: 1, id: 'YAW_45', name: 'Yaw45', eulerDeg: { roll: 0, pitch: 0, yaw: 45 } },
  { value: 2, id: 'YAW_90', name: 'Yaw90', eulerDeg: { roll: 0, pitch: 0, yaw: 90 } },
  { value: 3, id: 'YAW_135', name: 'Yaw135', eulerDeg: { roll: 0, pitch: 0, yaw: 135 } },
  { value: 4, id: 'YAW_180', name: 'Yaw180', eulerDeg: { roll: 0, pitch: 0, yaw: 180 } },
  { value: 5, id: 'YAW_225', name: 'Yaw225', eulerDeg: { roll: 0, pitch: 0, yaw: 225 } },
  { value: 6, id: 'YAW_270', name: 'Yaw270', eulerDeg: { roll: 0, pitch: 0, yaw: 270 } },
  { value: 7, id: 'YAW_315', name: 'Yaw315', eulerDeg: { roll: 0, pitch: 0, yaw: 315 } },
  { value: 8, id: 'ROLL_180', name: 'Roll180', eulerDeg: { roll: 180, pitch: 0, yaw: 0 } },
  { value: 9, id: 'ROLL_180_YAW_45', name: 'Yaw45Roll180', eulerDeg: { roll: 180, pitch: 0, yaw: 45 } },
  { value: 10, id: 'ROLL_180_YAW_90', name: 'Yaw90Roll180', eulerDeg: { roll: 180, pitch: 0, yaw: 90 } },
  { value: 11, id: 'ROLL_180_YAW_135', name: 'Yaw135Roll180', eulerDeg: { roll: 180, pitch: 0, yaw: 135 } },
  { value: 12, id: 'PITCH_180', name: 'Pitch180', eulerDeg: { roll: 0, pitch: 180, yaw: 0 } },
  { value: 13, id: 'ROLL_180_YAW_225', name: 'Yaw225Roll180', eulerDeg: { roll: 180, pitch: 0, yaw: 225 } },
  { value: 14, id: 'ROLL_180_YAW_270', name: 'Yaw270Roll180', eulerDeg: { roll: 180, pitch: 0, yaw: 270 } },
  { value: 15, id: 'ROLL_180_YAW_315', name: 'Yaw315Roll180', eulerDeg: { roll: 180, pitch: 0, yaw: 315 } },
  { value: 16, id: 'ROLL_90', name: 'Roll90', eulerDeg: { roll: 90, pitch: 0, yaw: 0 } },
  { value: 17, id: 'ROLL_90_YAW_45', name: 'Yaw45Roll90', eulerDeg: { roll: 90, pitch: 0, yaw: 45 } },
  { value: 18, id: 'ROLL_90_YAW_90', name: 'Yaw90Roll90', eulerDeg: { roll: 90, pitch: 0, yaw: 90 } },
  { value: 19, id: 'ROLL_90_YAW_135', name: 'Yaw135Roll90', eulerDeg: { roll: 90, pitch: 0, yaw: 135 } },
  { value: 20, id: 'ROLL_270', name: 'Roll270', eulerDeg: { roll: 270, pitch: 0, yaw: 0 } },
  { value: 21, id: 'ROLL_270_YAW_45', name: 'Yaw45Roll270', eulerDeg: { roll: 270, pitch: 0, yaw: 45 } },
  { value: 22, id: 'ROLL_270_YAW_90', name: 'Yaw90Roll270', eulerDeg: { roll: 270, pitch: 0, yaw: 90 } },
  { value: 23, id: 'ROLL_270_YAW_135', name: 'Yaw135Roll270', eulerDeg: { roll: 270, pitch: 0, yaw: 135 } },
  { value: 24, id: 'PITCH_90', name: 'Pitch90', eulerDeg: { roll: 0, pitch: 90, yaw: 0 } },
  { value: 25, id: 'PITCH_270', name: 'Pitch270', eulerDeg: { roll: 0, pitch: 270, yaw: 0 } },
  { value: 26, id: 'PITCH_180_YAW_90', name: 'Yaw90Pitch180', eulerDeg: { roll: 0, pitch: 180, yaw: 90 } },
  { value: 27, id: 'PITCH_180_YAW_270', name: 'Yaw270Pitch180', eulerDeg: { roll: 0, pitch: 180, yaw: 270 } },
  { value: 28, id: 'ROLL_90_PITCH_90', name: 'Pitch90Roll90', eulerDeg: { roll: 90, pitch: 90, yaw: 0 } },
  { value: 29, id: 'ROLL_180_PITCH_90', name: 'Pitch90Roll180', eulerDeg: { roll: 180, pitch: 90, yaw: 0 } },
  { value: 30, id: 'ROLL_270_PITCH_90', name: 'Pitch90Roll270', eulerDeg: { roll: 270, pitch: 90, yaw: 0 } },
  { value: 31, id: 'ROLL_90_PITCH_180', name: 'Pitch180Roll90', eulerDeg: { roll: 90, pitch: 180, yaw: 0 } },
  { value: 32, id: 'ROLL_270_PITCH_180', name: 'Pitch180Roll270', eulerDeg: { roll: 270, pitch: 180, yaw: 0 } },
  { value: 33, id: 'ROLL_90_PITCH_270', name: 'Pitch270Roll90', eulerDeg: { roll: 90, pitch: 270, yaw: 0 } },
  { value: 34, id: 'ROLL_180_PITCH_270', name: 'Pitch270Roll180', eulerDeg: { roll: 180, pitch: 270, yaw: 0 } },
  { value: 35, id: 'ROLL_270_PITCH_270', name: 'Pitch270Roll270', eulerDeg: { roll: 270, pitch: 270, yaw: 0 } },
  { value: 36, id: 'ROLL_90_PITCH_180_YAW_90', name: 'Yaw90Pitch180Roll90', eulerDeg: { roll: 90, pitch: 180, yaw: 90 } },
  { value: 37, id: 'ROLL_90_YAW_270', name: 'Yaw270Roll90', eulerDeg: { roll: 90, pitch: 0, yaw: 270 } },
  // The parameter label says Roll180, but the enum (and the matrix) is roll 90. The full-resolution
  // angles are not in the name; upstream special-cases them to these values.
  {
    value: 38,
    id: 'ROLL_90_PITCH_68_YAW_293',
    name: 'Yaw293Pitch68Roll180',
    eulerDeg: { roll: 90, pitch: 68.8, yaw: 293.3 }
  },
  { value: 39, id: 'PITCH_315', name: 'Pitch315', eulerDeg: { roll: 0, pitch: 315, yaw: 0 } },
  { value: 40, id: 'ROLL_90_PITCH_315', name: 'Pitch315Roll90', eulerDeg: { roll: 90, pitch: 315, yaw: 0 } },
  { value: 41, id: 'PITCH_7', name: 'Pitch7', eulerDeg: { roll: 0, pitch: 7, yaw: 0 } },
  { value: 42, id: 'ROLL_45', name: 'Roll45', eulerDeg: { roll: 45, pitch: 0, yaw: 0 } },
  { value: 43, id: 'ROLL_315', name: 'Roll315', eulerDeg: { roll: 315, pitch: 0, yaw: 0 } }
] as const satisfies readonly StandardRotationRow[]

/**
 * User-defined rotations. In ArduPilot their angles come from the CUSTOM_ROTn_* parameters; here
 * the user types them in.
 */
export const CUSTOM_ROTATIONS = [
  { value: 101, id: 'CUSTOM_1', name: 'Custom 1' },
  { value: 102, id: 'CUSTOM_2', name: 'Custom 2' }
] as const

export type StandardRotation = (typeof STANDARD_ROTATIONS)[number]
export type StandardRotationId = StandardRotation['id']
export type StandardRotationValue = StandardRotation['value']
export type CustomRotation = (typeof CUSTOM_ROTATIONS)[number]
export type CustomRotationValue = CustomRotation['value']

/** Every value the tool offers, in upstream's drop-down order. */
export type RotationValue = StandardRotationValue | CustomRotationValue

/** A row of either table. */
export type RotationInfo = StandardRotation | CustomRotation

export const ALL_ROTATIONS: readonly RotationInfo[] = [...STANDARD_ROTATIONS, ...CUSTOM_ROTATIONS]

/** Narrow a raw parameter value to a rotation the tool knows, or null. */
export function rotationInfo(value: number): RotationInfo | null {
  return ALL_ROTATIONS.find((r) => r.value === value) ?? null
}

export function isCustomRotation(info: RotationInfo): info is CustomRotation {
  return CUSTOM_ROTATIONS.some((r) => r.value === info.value)
}

export function standardRotation(value: StandardRotationValue): StandardRotation {
  const row = STANDARD_ROTATIONS.find((r) => r.value === value)
  if (row === undefined) throw new Error(`Unknown rotation ${value}`)
  return row
}

/** Upstream drop-down label, e.g. `2:Yaw90`. */
export function rotationLabel(info: RotationInfo): string {
  return `${info.value}:${info.name}`
}

/**
 * Case-insensitive search over value, label and enum name, so "yaw90", "ROLL_90" and "18" all
 * find rotation 18.
 */
export function matchesRotationSearch(info: RotationInfo, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  const haystack = [String(info.value), info.name, `ROTATION_${info.id}`, rotationLabel(info)].join(' ').toLowerCase()
  return q.split(/\s+/).every((word) => haystack.includes(word))
}
