/**
 * Decoded sensor device ids annotated with DroneCAN node names (upstream `print_device`).
 */
import type { CanInventory } from './can.js'
import { canNameForDevice } from './can.js'
import { decodeDevId, type DecodedDevId, type DeviceType } from './shared/decode-devid.js'

/** A sensor's device id, decoded. */
export interface SensorDevice {
  /** Raw device id parameter value. */
  readonly devId: number
  /** Bus/address/type breakdown. */
  readonly decoded: DecodedDevId
  /** Name of the DroneCAN node for DroneCAN devices, when CAND logged it. */
  readonly canName: string | undefined
}

/** Decode a device id and look up its DroneCAN node name. */
export function describeDevice(devId: number, type: DeviceType, can: CanInventory): SensorDevice {
  const decoded = decodeDevId(devId, type)
  const canName = decoded.kind === 'dronecan' ? canNameForDevice(can, decoded.bus, decoded.address) : undefined
  return { devId, decoded, canName }
}

/** Display lines for a device, exactly as upstream `print_device` writes them. */
export function deviceLines(device: SensorDevice): readonly string[] {
  const d = device.decoded
  if (d.kind === 'dronecan') {
    const lines = [`${d.busType} bus: ${d.bus} node id: ${d.address} sensor: ${d.sensorId}`]
    if (device.canName !== undefined) lines.push('Name: ' + device.canName)
    return lines
  }
  return [`${d.name} via ${d.busType}`]
}
