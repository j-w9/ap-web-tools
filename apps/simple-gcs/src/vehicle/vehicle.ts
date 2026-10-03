/** Vehicle classification, Rover modes and LTE carrier names (upstream `SimpleGCS/util.js`). */
import { MavType } from '@apwt/mavlink'

/** Map icon family (upstream `classifyVehicle`). */
export type VehicleClass = 'boat' | 'rover' | 'plane' | 'copter'

export function classifyVehicle(mavType: number): VehicleClass {
  if (mavType === MavType.MAV_TYPE_SURFACE_BOAT) return 'boat'
  if (mavType === MavType.MAV_TYPE_GROUND_ROVER) return 'rover'
  if (mavType === MavType.MAV_TYPE_FIXED_WING) return 'plane'
  if (mavType === MavType.MAV_TYPE_QUADROTOR || mavType === MavType.MAV_TYPE_COAXIAL || mavType === MavType.MAV_TYPE_HELICOPTER) {
    return 'copter'
  }
  return 'plane'
}

/** Whether Rover mode numbers apply (ground rover or surface boat). */
export const isRoverish = (mavType: number | null): boolean =>
  mavType === MavType.MAV_TYPE_GROUND_ROVER || mavType === MavType.MAV_TYPE_SURFACE_BOAT

/** Rover custom modes. */
export const ROVER_MODES = {
  MANUAL: 0,
  ACRO: 1,
  STEERING: 3,
  HOLD: 4,
  LOITER: 5,
  FOLLOW: 6,
  SIMPLE: 7,
  DOCK: 8,
  CIRCLE: 9,
  AUTO: 10,
  RTL: 11,
  SMART_RTL: 12,
  GUIDED: 15,
  INITIALISING: 16
} as const
export type RoverModeName = keyof typeof ROVER_MODES

const ROVER_MODE_NAMES: ReadonlyMap<number, RoverModeName> = new Map(
  Object.entries(ROVER_MODES).map(([name, value]): [number, RoverModeName] => [value, name as RoverModeName])
)

/** Mode text shown for a heartbeat: Rover names for rovers and boats, the number otherwise. */
export function modeName(mavType: number, customMode: number): string {
  return isRoverish(mavType) ? (ROVER_MODE_NAMES.get(customMode) ?? `${customMode}`) : `${customMode}`
}

/** LTE carriers by MCC/MNC. */
export const MCCMNC_MAP: Readonly<Record<number, string>> = {
  // Australia
  50501: 'AU Telstra',
  50502: 'AU Optus',
  50503: 'AU Vodafone',
  // United Kingdom (common MNCs)
  23410: 'UK O2',
  23411: 'UK O2',
  23402: 'UK O2',
  23415: 'UK Voda',
  23420: 'UK Three',
  23430: 'UK EE(T-M)',
  23433: 'UK EE(O)',
  23431: 'UK EE',
  23432: 'UK EE',
  23434: 'UK EE'
}

/** Strips trailing NULs from a MAVLink string (upstream `mavStr`). */
export const mavStr = (text: string): string => text.replace(/\0+$/, '')
