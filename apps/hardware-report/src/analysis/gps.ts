/**
 * GPS receivers (upstream `load_gps()` and `print_gps()`).
 */
import type { DataflashLog } from '@apwt/dataflash'
import { canNameForNodeId, type CanInventory } from './can.js'
import { paramVector3, type ParamVector3 } from './param-arrays.js'
import type { ParamValues } from './params.js'
import { paramNameVector3 } from './shared/param-helpers.js'

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

/** Device names per 0-based GPS index from boot messages (upstream regexes). */
export function gpsDevicesFromMessages(messages: readonly string[]): Map<number, string> {
  const out = new Map<number, string>()
  const regexDevice = /(?<=as\s)(\S+)/i
  const regexNumber = /(?<=GPS\s)(\d+)/
  for (const message of messages) {
    if (!message.startsWith('GPS')) continue
    const num = message.match(regexNumber)
    const device = message.match(regexDevice)
    if (num !== null && device !== null) out.set(parseInt(num[0]) - 1, device[0])
  }
  return out
}

/**
 * GPS receivers from `GPS_TYPE[n]` (pre 4.6) or `GPSn_TYPE` (4.6+) parameters.
 *
 * Upstream only displays receivers whose device name was found in the boot messages (so
 * never for `.param` files); every configured receiver is returned here and the UI can
 * filter on {@link GpsSensor.device}. Deviation: upstream throws when a message names a GPS
 * that is not configured; such messages are ignored.
 */
export function readGps(params: ParamValues, log: DataflashLog | undefined, can: CanInventory): (GpsSensor | undefined)[] {
  const devices = log === undefined ? new Map<number, string>() : gpsDevicesFromMessages(log.textMessages())
  const out: (GpsSensor | undefined)[] = []
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
      out.push(undefined)
      continue
    }
    const canName =
      DRONECAN_GPS_TYPES.has(found.type) && found.nodeId !== undefined ? canNameForNodeId(can, found.nodeId) : undefined
    out.push({ number: i + 1, ...found, typeName: GPS_TYPE_NAMES[found.type], device: devices.get(i), canName })
  }
  return out
}
