// ArduPilot sensor rotations (the `Rotation` enum / COMPASS_ORIENTx values), ported from upstream
// MAGFit/quaternion.js (`from_rotation`, `right_angle_rotation`, `get_rotation_name`).

import type { Quat } from './quaternion.js'

/** ArduPilot `Rotation` enum values (upstream `ROTATION_*` constants). */
export const Rotation = {
  none: 0,
  yaw45: 1,
  yaw90: 2,
  yaw135: 3,
  yaw180: 4,
  yaw225: 5,
  yaw270: 6,
  yaw315: 7,
  roll180: 8,
  roll180Yaw45: 9,
  roll180Yaw90: 10,
  roll180Yaw135: 11,
  pitch180: 12,
  roll180Yaw225: 13,
  roll180Yaw270: 14,
  roll180Yaw315: 15,
  roll90: 16,
  roll90Yaw45: 17,
  roll90Yaw90: 18,
  roll90Yaw135: 19,
  roll270: 20,
  roll270Yaw45: 21,
  roll270Yaw90: 22,
  roll270Yaw135: 23,
  pitch90: 24,
  pitch270: 25,
  pitch180Yaw90: 26,
  pitch180Yaw270: 27,
  roll90Pitch90: 28,
  roll180Pitch90: 29,
  roll270Pitch90: 30,
  roll90Pitch180: 31,
  roll270Pitch180: 32,
  roll90Pitch270: 33,
  roll180Pitch270: 34,
  roll270Pitch270: 35,
  roll90Pitch180Yaw90: 36,
  roll90Yaw270: 37,
  roll90Pitch68Yaw293: 38,
  pitch315: 39,
  roll90Pitch315: 40,
  pitch7: 41,
  roll45: 42,
  roll315: 43
} as const

/** Highest rotation number tried by the orientation check. */
export const LAST_ROTATION = 43

// Long literals are written as the shortest decimal of the same double upstream gets from its
// longer literals, so the values are bit-identical.
const HALF_SQRT_2 = 0.7071067811865476
const HALF_SQRT_2_PLUS_SQRT_2 = 0.9238795325112867 // sqrt(2 + sqrt(2)) / 2
const HALF_SQRT_2_MINUS_SQRT_2 = 0.3826834323650897 // sqrt(2 - sqrt(2)) / 2
const HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO = 0.6532814824381883 // sqrt((2 + sqrt(2))/2) / 2
const HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO = 0.27059805007309845 // sqrt((2 - sqrt(2))/2) / 2

const q = (q1: number, q2: number, q3: number, q4: number): Quat => ({ q1, q2, q3, q4 })

// Indexed by rotation number. Entries 26 and 27 are deliberately absent: upstream has those
// cases commented out in `from_rotation` (they duplicate 14 and 10), so it returns false for them.
const ROTATION_QUATS: ReadonlyMap<number, Quat> = new Map([
  [0, q(1, 0, 0, 0)],
  [1, q(HALF_SQRT_2_PLUS_SQRT_2, 0, 0, HALF_SQRT_2_MINUS_SQRT_2)],
  [2, q(HALF_SQRT_2, 0, 0, HALF_SQRT_2)],
  [3, q(HALF_SQRT_2_MINUS_SQRT_2, 0, 0, HALF_SQRT_2_PLUS_SQRT_2)],
  [4, q(0, 0, 0, 1)],
  [5, q(-HALF_SQRT_2_MINUS_SQRT_2, 0, 0, HALF_SQRT_2_PLUS_SQRT_2)],
  [6, q(HALF_SQRT_2, 0, 0, -HALF_SQRT_2)],
  [7, q(HALF_SQRT_2_PLUS_SQRT_2, 0, 0, -HALF_SQRT_2_MINUS_SQRT_2)],
  [8, q(0, 1, 0, 0)],
  [9, q(0, HALF_SQRT_2_PLUS_SQRT_2, HALF_SQRT_2_MINUS_SQRT_2, 0)],
  [10, q(0, HALF_SQRT_2, HALF_SQRT_2, 0)],
  [11, q(0, HALF_SQRT_2_MINUS_SQRT_2, HALF_SQRT_2_PLUS_SQRT_2, 0)],
  [12, q(0, 0, 1, 0)],
  [13, q(0, -HALF_SQRT_2_MINUS_SQRT_2, HALF_SQRT_2_PLUS_SQRT_2, 0)],
  [14, q(0, -HALF_SQRT_2, HALF_SQRT_2, 0)],
  [15, q(0, HALF_SQRT_2_PLUS_SQRT_2, -HALF_SQRT_2_MINUS_SQRT_2, 0)],
  [16, q(HALF_SQRT_2, HALF_SQRT_2, 0, 0)],
  [
    17,
    q(
      HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO,
      HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO,
      HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO,
      HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO
    )
  ],
  [18, q(0.5, 0.5, 0.5, 0.5)],
  [
    19,
    q(
      HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO,
      HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO,
      HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO,
      HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO
    )
  ],
  [20, q(HALF_SQRT_2, -HALF_SQRT_2, 0, 0)],
  [
    21,
    q(
      HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO,
      -HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO,
      -HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO,
      HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO
    )
  ],
  [22, q(0.5, -0.5, -0.5, 0.5)],
  [
    23,
    q(
      HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO,
      -HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO,
      -HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO,
      HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO
    )
  ],
  [24, q(HALF_SQRT_2, 0, HALF_SQRT_2, 0)],
  [25, q(HALF_SQRT_2, 0, -HALF_SQRT_2, 0)],
  [28, q(-0.5, -0.5, -0.5, 0.5)],
  [29, q(0, -HALF_SQRT_2, 0, HALF_SQRT_2)],
  [30, q(0.5, -0.5, 0.5, 0.5)],
  [31, q(0, 0, -HALF_SQRT_2, HALF_SQRT_2)],
  [32, q(0, 0, HALF_SQRT_2, HALF_SQRT_2)],
  [33, q(0.5, 0.5, -0.5, 0.5)],
  [34, q(0, HALF_SQRT_2, 0, HALF_SQRT_2)],
  [35, q(-0.5, 0.5, 0.5, 0.5)],
  [36, q(-0.5, 0.5, -0.5, 0.5)],
  [37, q(-0.5, -0.5, 0.5, 0.5)],
  [38, q(0.26774500501681575, 0.7069880468895242, 0.01295768325496266, -0.6544559666536361)],
  [39, q(HALF_SQRT_2_PLUS_SQRT_2, 0, -HALF_SQRT_2_MINUS_SQRT_2, 0)],
  [
    40,
    q(
      HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO,
      HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO,
      -HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO,
      HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO
    )
  ],
  [41, q(0.9981347984218669, 0, 0.06104853953485687, 0)],
  [42, q(HALF_SQRT_2_PLUS_SQRT_2, HALF_SQRT_2_MINUS_SQRT_2, 0, 0)],
  [43, q(HALF_SQRT_2_PLUS_SQRT_2, -HALF_SQRT_2_MINUS_SQRT_2, 0, 0)]
])

/**
 * Quaternion for an ArduPilot rotation number (upstream `from_rotation`), or `undefined` for
 * unknown numbers (upstream returns false). Like upstream, 26 and 27 are not supported.
 */
export function rotationQuat(rotation: number): Quat | undefined {
  return ROTATION_QUATS.get(rotation)
}

const RIGHT_ANGLE_ROTATIONS: ReadonlySet<number> = new Set([
  0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37
])

/** Whether a rotation is a combination of 90 degree steps (upstream `right_angle_rotation`). */
export function isRightAngleRotation(rotation: number): boolean {
  return RIGHT_ANGLE_ROTATIONS.has(rotation)
}

const ROTATION_NAMES: ReadonlyMap<number, string> = new Map([
  [0, 'None'],
  [1, 'Yaw45'],
  [2, 'Yaw90'],
  [3, 'Yaw135'],
  [4, 'Yaw180'],
  [5, 'Yaw225'],
  [6, 'Yaw270'],
  [7, 'Yaw315'],
  [8, 'Roll180'],
  [9, 'Yaw45Roll180'],
  [10, 'Yaw90Roll180'],
  [11, 'Yaw135Roll180'],
  [12, 'Pitch180'],
  [13, 'Yaw225Roll180'],
  [14, 'Yaw270Roll180'],
  [15, 'Yaw315Roll180'],
  [16, 'Roll90'],
  [17, 'Yaw45Roll90'],
  [18, 'Yaw90Roll90'],
  [19, 'Yaw135Roll90'],
  [20, 'Roll270'],
  [21, 'Yaw45Roll270'],
  [22, 'Yaw90Roll270'],
  [23, 'Yaw135Roll270'],
  [24, 'Pitch90'],
  [25, 'Pitch270'],
  [26, 'Yaw90Pitch180'],
  [27, 'Yaw270Pitch180'],
  [28, 'Pitch90Roll90'],
  [29, 'Pitch90Roll180'],
  [30, 'Pitch90Roll270'],
  [31, 'Pitch180Roll90'],
  [32, 'Pitch180Roll270'],
  [33, 'Pitch270Roll90'],
  [34, 'Pitch270Roll180'],
  [35, 'Pitch270Roll270'],
  [36, 'Yaw90Pitch180Roll90'],
  [37, 'Yaw270Roll90'],
  [38, 'Yaw293Pitch68Roll180'],
  [39, 'Pitch315'],
  [40, 'Pitch315Roll90'],
  [42, 'Roll45'],
  [43, 'Roll315'],
  [100, 'Custom 4.1 and older'],
  [101, 'Custom 1'],
  [102, 'Custom 2']
])

/**
 * Display name `"<n>:<Name>"` for a rotation (upstream `get_rotation_name`), or `undefined`
 * when the number has no name (41 has none upstream either).
 */
export function rotationName(rotation: number): string | undefined {
  const name = ROTATION_NAMES.get(rotation)
  return name === undefined ? undefined : `${rotation}:${name}`
}
