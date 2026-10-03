/**
 * GPS receivers (upstream `load_gps()` and `print_gps()`).
 */
import type { DataflashLog } from '@apwt/dataflash'
import { canNameForNodeId, type CanInventory } from './can.js'
import { paramVector3, type ParamVector3 } from './param-arrays.js'
import type { ParamValues } from './params.js'
import { paramNameVector3 } from '@apwt/ardupilot'

/** Number of GPS slots. */
export const MAX_NUM_GPS = 2

/** `GPS_TYPE` value names (upstream `print_gps` table). */
export const GPS_TYPE_NAMES: Readonly<Record<number, string>> = {
  0: 'None',
  1: 'AUTO',
  2: 'uBlox',
  5: 'NMEA',
  6: 'SiRF',
  7: 'HIL',
  8: 'SwiftNav',
  9: 'DroneCAN',
  10: 'SBF',
  11: 'GSOF',
  13: 'ERB',
  14: 'MAV',
  15: 'NOVA',
  16: 'HemisphereNMEA',
  17: 'uBlox-MovingBaseline-Base',
  18: 'uBlox-MovingBaseline-Rover',
  19: 'MSP',
  20: 'AllyStar',
  21: 'ExternalAHRS',
  22: 'DroneCAN-MovingBaseline-Base',
  23: 'DroneCAN-MovingBaseline-Rover',
  24: 'UnicoreNMEA',
  25: 'UnicoreMovingBaselineNMEA',
  26: 'SBF-DualAntenna'
}

const DRONECAN_GPS_TYPES = new Set([9, 22, 23])

/** One configured GPS. */
export interface GpsSensor {
  /** 1-based number. */
  readonly number: number
  /** `GPS_TYPE` value. */
  readonly type: number
  /** Name of the type, when known. */
  readonly typeName: string | undefined
  /** Antenna position offset. */
  readonly pos: ParamVector3
  /** DroneCAN node id parameter. */
  readonly nodeId: number | undefined
  /** Moving-baseline offsets when the moving-base type is 1, else `undefined`. */
  readonly movingBase: ParamVector3 | undefined
  /** Device name detected at boot (from MSG `"GPS n: detected as <name>"`). */
  readonly device: string | undefined
  /** DroneCAN node name for DroneCAN types, when the node id is unique across drivers. */
  readonly canName: string | undefined
}

function movingBase(params: ParamValues, prefix: string): ParamVector3 | undefined {
  // Moving-base offsets are only used with type 1.
  if (params.get(prefix + 'TYPE') !== 1) return undefined
  return paramVector3(params, paramNameVector3(prefix + 'OFS_'))
}

/** A boot message naming a GPS receiver, e.g. `"GPS 1: detected as u-blox at 115200 baud"`. */
export interface GpsDeviceMessage {
  /** 0-based GPS index (`n - 1`; may be out of range). */
  readonly index: number
  /** Word after "as". */
  readonly device: string
  /** The message. */
  readonly message: string
}

/** Boot messages that name a GPS device, in log order (upstream regexes). */
export function gpsDeviceMessages(messages: readonly string[]): GpsDeviceMessage[] {
  const out: GpsDeviceMessage[] = []
  const regexDevice = /(?<=as\s)(\S+)/i
  const regexNumber = /(?<=GPS\s)(\d+)/
  for (const message of messages) {
    if (!message.startsWith('GPS')) continue
    const num = message.match(regexNumber)
    const device = message.match(regexDevice)
    if (num !== null && device !== null) out.push({ index: parseInt(num[0]) - 1, device: device[0], message })
  }
  return out
}

/**
 * Thrown where upstream `load_gps` crashes: a boot message names a GPS number that is not
 * configured (upstream assigns to `gps[n].device` of a missing entry and the report stops).
 */
export class UnconfiguredGpsError extends Error {
  constructor(readonly gps: GpsDeviceMessage) {
    super(`The log message "${gps.message}" names GPS ${gps.index + 1}, which is not configured; the report can not be built.`)
    this.name = 'UnconfiguredGpsError'
  }
}

/**
 * GPS receivers from `GPS_TYPE[n]` (pre 4.6) or `GPSn_TYPE` (4.6+) parameters, with the device
 * name from the last boot message naming each (upstream `load_gps`). Every configured receiver
 * is returned, as the offset plot uses them all; upstream lists only those with a
 * {@link GpsSensor.device}, which the UI filters on.
 *
 * @throws {UnconfiguredGpsError} where upstream crashes (a message names an unconfigured GPS).
 */
export function readGps(params: ParamValues, log: DataflashLog | undefined, can: CanInventory): (GpsSensor | undefined)[] {
  const configured: (Omit<GpsSensor, 'device'> | undefined)[] = []
  for (let i = 0; i < MAX_NUM_GPS; i++) {
    let found: { type: number; pos: ParamVector3; nodeId: number | undefined; movingBase: ParamVector3 | undefined } | undefined
    const oldType = params.get(i === 0 ? 'GPS_TYPE' : `GPS_TYPE${i + 1}`)
    const newPrefix = `GPS${i + 1}`
    const newType = params.get(newPrefix + '_TYPE')
    if (oldType !== undefined) {
      if (oldType !== 0) {
        found = {
          type: oldType,
          pos: paramVector3(params, paramNameVector3(`GPS_POS${i + 1}_`)),
          nodeId: params.get(`GPS_CAN_NODEID${i + 1}`),
          movingBase: movingBase(params, `GPS_MB${i + 1}_`)
        }
      }
    } else if (newType !== undefined && newType !== 0) {
      // Per-instance parameters for 4.6+.
      found = {
        type: newType,
        pos: paramVector3(params, paramNameVector3(newPrefix + '_POS_')),
        nodeId: params.get(newPrefix + '_CAN_NODEID'),
        movingBase: movingBase(params, newPrefix + '_MB_')
      }
    }
    if (found === undefined) {
      configured.push(undefined)
      continue
    }
    const canName =
      DRONECAN_GPS_TYPES.has(found.type) && found.nodeId !== undefined ? canNameForNodeId(can, found.nodeId) : undefined
    configured.push({ number: i + 1, ...found, typeName: GPS_TYPE_NAMES[found.type], canName })
  }

  const devices = new Map<number, string>()
  for (const m of log === undefined ? [] : gpsDeviceMessages(log.textMessages())) {
    if (configured[m.index] === undefined) throw new UnconfiguredGpsError(m)
    devices.set(m.index, m.device)
  }
  return configured.map((g, i) => (g === undefined ? undefined : { ...g, device: devices.get(i) }))
}
