// Airspeed device id decoding, ported from the airspeed case of upstream Libraries/DecodeDevID.js
// (`decode_devid` with DEVICE_TYPE_AIRSPEED), and the one-line description AirspeedFit shows.

const BUS_TYPES: ReadonlyMap<number, string> = new Map([
  [1, 'I2C'],
  [2, 'SPI'],
  [3, 'DRONECAN'],
  [4, 'SITL'],
  [5, 'MSP'],
  [6, 'SERIAL']
])

const AIRSPEED_TYPES: ReadonlyMap<number, string> = new Map([
  [0x01, 'SITL'],
  [0x02, 'MS4525'],
  [0x03, 'MS5525'],
  [0x04, 'DLVR'],
  [0x05, 'MSP'],
  [0x06, 'SDP3X'],
  [0x07, 'DRONECAN'],
  [0x08, 'ANALOG'],
  [0x09, 'NMEA'],
  [0x0a, 'ASP5033'],
  [0x0b, 'AUAV']
])

/** Bus type number DroneCAN devices report. */
const DRONECAN_BUS = 3

/** Fields of an airspeed device id. DroneCAN ids carry a sensor id instead of a device type. */
export type AirspeedDevice = {
  readonly name: string
  readonly busType: string
  readonly bus: number
  readonly address: number
} & ({ readonly dronecan: true; readonly sensorId: number } | { readonly dronecan: false; readonly devtype: number })

/** Decode an `ARSPD_DEVID` value. */
export function decodeAirspeedDevId(id: number): AirspeedDevice {
  const busTypeIndex = id & 0x07
  const devtype = id >> 16
  const common = {
    name: AIRSPEED_TYPES.get(devtype) ?? 'Unknown',
    busType: BUS_TYPES.get(busTypeIndex) ?? 'Unknown',
    bus: (id >> 3) & 0x1f,
    address: (id >> 8) & 0xff
  }
  return busTypeIndex === DRONECAN_BUS
    ? { ...common, dronecan: true, sensorId: devtype - 1 }
    : { ...common, dronecan: false, devtype }
}

/**
 * One-line description as upstream's sensor summary shows it: "MS4525 via I2C", or for DroneCAN
 * "DRONECAN bus: 1 node id: 12" plus the sensor id when it is set; "ARSP instance N" without an id.
 */
export function describeAirspeedDevice(id: number | undefined, instance: number): string {
  if (id === undefined) return `ARSP instance ${instance}`
  const d = decodeAirspeedDevId(id)
  if (d.dronecan) {
    return `${d.busType} bus: ${d.bus} node id: ${d.address}${d.sensorId >= 0 ? ` sensor: ${d.sensorId}` : ''}`
  }
  return `${d.name} via ${d.busType}`
}
