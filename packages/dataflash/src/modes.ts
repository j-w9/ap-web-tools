/**
 * Vehicle types and flight-mode name tables.
 */

/** MAVLink MAV_TYPE values relevant to ArduPilot logs. */
export const MavType = {
  GENERIC: 0,
  FIXED_WING: 1,
  QUADROTOR: 2,
  COAXIAL: 3,
  HELICOPTER: 4,
  ANTENNA_TRACKER: 5,
  GCS: 6,
  AIRSHIP: 7,
  FREE_BALLOON: 8,
  ROCKET: 9,
  GROUND_ROVER: 10,
  SURFACE_BOAT: 11,
  SUBMARINE: 12,
  HEXAROTOR: 13,
  OCTOROTOR: 14,
  TRICOPTER: 15,
  FLAPPING_WING: 16,
  KITE: 17,
  ONBOARD_CONTROLLER: 18,
  VTOL_DUOROTOR: 19,
  VTOL_QUADROTOR: 20,
  VTOL_TILTROTOR: 21,
  VTOL_RESERVED2: 22,
  VTOL_RESERVED3: 23,
  VTOL_RESERVED4: 24,
  VTOL_RESERVED5: 25,
  GIMBAL: 26,
  ADSB: 27,
  PARAFOIL: 28,
  DODECAROTOR: 29,
  CAMERA: 30,
  CHARGING_STATION: 31,
  FLARM: 32,
  SERVO: 33,
  ODID: 34,
  DECAROTOR: 35,
  BATTERY: 36,
  PARACHUTE: 37,
  LOG: 38,
  OSD: 39,
  IMU: 40,
  GPS: 41,
  WINCH: 42,
  AIRSHIP_BLIMP: 43
} as const

/** Numeric MAV_TYPE value. */
export type MavType = (typeof MavType)[keyof typeof MavType]

/** ArduPilot vehicle firmware families. */
export type VehicleType = 'copter' | 'plane' | 'rover' | 'sub' | 'tracker' | 'blimp'

const planeModes: ReadonlyMap<number, string> = new Map([
  [0, 'MANUAL'],
  [1, 'CIRCLE'],
  [2, 'STABILIZE'],
  [3, 'TRAINING'],
  [4, 'ACRO'],
  [5, 'FBWA'],
  [6, 'FBWB'],
  [7, 'CRUISE'],
  [8, 'AUTOTUNE'],
  [10, 'AUTO'],
  [11, 'RTL'],
  [12, 'LOITER'],
  [13, 'TAKEOFF'],
  [14, 'AVOID_ADSB'],
  [15, 'GUIDED'],
  [16, 'INITIALISING'],
  [17, 'QSTABILIZE'],
  [18, 'QHOVER'],
  [19, 'QLOITER'],
  [20, 'QLAND'],
  [21, 'QRTL'],
  [22, 'QAUTOTUNE'],
  [23, 'QACRO'],
  [24, 'THERMAL'],
  [25, 'LOITER_ALT_QLAND'],
  [26, 'AUTOLAND']
])

const copterModes: ReadonlyMap<number, string> = new Map([
  [0, 'STABILIZE'],
  [1, 'ACRO'],
  [2, 'ALT_HOLD'],
  [3, 'AUTO'],
  [4, 'GUIDED'],
  [5, 'LOITER'],
  [6, 'RTL'],
  [7, 'CIRCLE'],
  [9, 'LAND'],
  [11, 'DRIFT'],
  [13, 'SPORT'],
  [14, 'FLIP'],
  [15, 'AUTOTUNE'],
  [16, 'POSHOLD'],
  [17, 'BRAKE'],
  [18, 'THROW'],
  [19, 'AVOID_ADSB'],
  [20, 'GUIDED_NOGPS'],
  [21, 'SMART_RTL'],
  [22, 'FLOWHOLD'],
  [23, 'FOLLOW'],
  [24, 'ZIGZAG'],
  [25, 'SYSTEMID'],
  [26, 'AUTOROTATE'],
  [27, 'AUTO_RTL'],
  [28, 'TURTLE']
])

const roverModes: ReadonlyMap<number, string> = new Map([
  [0, 'MANUAL'],
  [1, 'ACRO'],
  [3, 'STEERING'],
  [4, 'HOLD'],
  [5, 'LOITER'],
  [6, 'FOLLOW'],
  [7, 'SIMPLE'],
  [8, 'DOCK'],
  [9, 'CIRCLE'],
  [10, 'AUTO'],
  [11, 'RTL'],
  [12, 'SMART_RTL'],
  [15, 'GUIDED'],
  [16, 'INITIALISING']
])

const trackerModes: ReadonlyMap<number, string> = new Map([
  [0, 'MANUAL'],
  [1, 'STOP'],
  [2, 'SCAN'],
  [3, 'SERVO_TEST'],
  [4, 'GUIDED'],
  [10, 'AUTO'],
  [16, 'INITIALISING']
])

const subModes: ReadonlyMap<number, string> = new Map([
  [0, 'STABILIZE'],
  [1, 'ACRO'],
  [2, 'ALT_HOLD'],
  [3, 'AUTO'],
  [4, 'GUIDED'],
  [7, 'CIRCLE'],
  [9, 'SURFACE'],
  [16, 'POSHOLD'],
  [19, 'MANUAL'],
  [20, 'MOTOR_DETECT'],
  [21, 'SURFTRAK']
])

const blimpModes: ReadonlyMap<number, string> = new Map([
  [0, 'LAND'],
  [1, 'MANUAL'],
  [2, 'VELOCITY'],
  [3, 'LOITER'],
  [4, 'RTL']
])

const MODE_TABLES: Readonly<Record<VehicleType, ReadonlyMap<number, string>>> = {
  copter: copterModes,
  plane: planeModes,
  rover: roverModes,
  sub: subModes,
  tracker: trackerModes,
  blimp: blimpModes
}

/** Mode-number to mode-name table for a vehicle family. */
export function modeTable(vehicle: VehicleType): ReadonlyMap<number, string> {
  return MODE_TABLES[vehicle]
}

/** Vehicle family for a MAV_TYPE, or `undefined` if it is not a vehicle ArduPilot flies. */
export function vehicleTypeForMavType(mavType: number): VehicleType | undefined {
  switch (mavType) {
    case MavType.QUADROTOR:
    case MavType.HELICOPTER:
    case MavType.HEXAROTOR:
    case MavType.OCTOROTOR:
    case MavType.COAXIAL:
    case MavType.TRICOPTER:
    case MavType.DODECAROTOR:
    case MavType.DECAROTOR:
      return 'copter'
    case MavType.FIXED_WING:
    case MavType.VTOL_DUOROTOR:
    case MavType.VTOL_QUADROTOR:
    case MavType.VTOL_TILTROTOR:
      return 'plane'
    case MavType.GROUND_ROVER:
    case MavType.SURFACE_BOAT:
      return 'rover'
    case MavType.ANTENNA_TRACKER:
      return 'tracker'
    case MavType.SUBMARINE:
      return 'sub'
    case MavType.AIRSHIP_BLIMP:
      return 'blimp'
    default:
      return undefined
  }
}

/** Representative MAV_TYPE for a vehicle family. */
export function mavTypeForVehicle(vehicle: VehicleType): MavType {
  switch (vehicle) {
    case 'copter':
      return MavType.QUADROTOR
    case 'plane':
      return MavType.FIXED_WING
    case 'rover':
      return MavType.GROUND_ROVER
    case 'tracker':
      return MavType.ANTENNA_TRACKER
    case 'sub':
      return MavType.SUBMARINE
    case 'blimp':
      return MavType.AIRSHIP_BLIMP
  }
}

/**
 * Detect the vehicle family from the firmware banner lines in MSG records
 * (e.g. `"ArduCopter V4.5.1 (abc123)"`).
 *
 * @returns the family, or `undefined` when no banner is recognised.
 */
export function detectVehicleType(messages: Iterable<string>): VehicleType | undefined {
  for (const raw of messages) {
    const text = raw.toLowerCase()
    if (text.includes('arduplane')) return 'plane'
    if (text.includes('arducopter')) return 'copter'
    if (text.includes('ardusub')) return 'sub'
    if (text.includes('blimp')) return 'blimp'
    if (text.includes('rover')) return 'rover'
    if (text.includes('tracker')) return 'tracker'
  }
  return undefined
}

/** Name of a mode number for a vehicle family; `undefined` for unknown modes. */
export function modeName(vehicle: VehicleType, mode: number): string | undefined {
  return MODE_TABLES[vehicle].get(mode)
}

/** One MODE record. */
export interface ModeChange {
  /** Timestamp in microseconds since boot. */
  readonly timeUs: number
  /** Mode number as logged. */
  readonly mode: number
  /** Mode-change reason code (`Rsn`), or `undefined` for very old logs. */
  readonly reason: number | undefined
  /** Mode name per the vehicle's table, or `"UNKNOWN(<n>)"` when not in the table. */
  readonly name: string
}
