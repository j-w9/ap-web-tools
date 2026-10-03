/** Facts about a loaded log for the rail. */
import type { DataflashLog, VehicleType } from '@apwt/dataflash'

const VEHICLE_NAMES: Readonly<Record<VehicleType, string>> = {
  copter: 'Copter',
  plane: 'Plane',
  rover: 'Rover',
  sub: 'Sub',
  tracker: 'Tracker',
  blimp: 'Blimp'
}

export interface LogSummary {
  /** Display name of the vehicle, or "Unknown". */
  readonly vehicle: string
  /** Message types with at least one record, sorted by name. */
  readonly messageTypes: readonly string[]
  readonly bytes: number
}

export function summarizeLog(log: DataflashLog): LogSummary {
  const vehicle = log.vehicleType()
  return {
    vehicle: vehicle === undefined ? 'Unknown' : VEHICLE_NAMES[vehicle],
    messageTypes: [...log.messageTypes().keys()].sort(),
    bytes: log.byteLength
  }
}
