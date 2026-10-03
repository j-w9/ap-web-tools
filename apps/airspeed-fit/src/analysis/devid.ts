// The one-line airspeed device description AirspeedFit shows (upstream `build_sensor_summaries`),
// on top of the shared `decodeDevId` (upstream Libraries/DecodeDevID.js).
import { decodeDevId, describeDevId, DeviceType } from '@apwt/ardupilot'

/**
 * "MS4525 via I2C", or for DroneCAN "DRONECAN bus: 1 node id: 12" plus " sensor: N" only when the
 * sensor id is set (upstream AirspeedFit hides the usual -1, unlike the shared `describeDevId`);
 * "ARSP instance N" without an id.
 */
export function describeAirspeedDevice(id: number | undefined, instance: number): string {
  if (id === undefined) return `ARSP instance ${instance}`
  const d = decodeDevId(id, DeviceType.airspeed)
  if (d.kind === 'dronecan' && d.sensorId < 0) return `${d.busType} bus: ${d.bus} node id: ${d.address}`
  return describeDevId(d)
}
