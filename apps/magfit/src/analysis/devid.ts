// Compass device id decoding, ported from the compass case of upstream Libraries/DecodeDevID.js
// (`decode_devid` with DEVICE_TYPE_COMPASS). Used for the per-compass description.

const BUS_TYPES: ReadonlyMap<number, string> = new Map([
  [1, 'I2C'],
  [2, 'SPI'],
  [3, 'DRONECAN'],
  [4, 'SITL'],
  [5, 'MSP'],
  [6, 'SERIAL']
])

const COMPASS_TYPES: ReadonlyMap<number, string> = new Map([
  [0x01, 'HMC5883_OLD'],
  [0x07, 'HMC5883'],
  [0x02, 'LSM303D'],
  [0x04, 'AK8963 '],
  [0x05, 'BMM150 '],
  [0x06, 'LSM9DS1'],
  [0x08, 'LIS3MDL'],
  [0x09, 'AK09916'],
  [0x0a, 'IST8310'],
  [0x0b, 'ICM20948'],
  [0x0c, 'MMC3416'],
  [0x0d, 'QMC5883L'],
  [0x0e, 'MAG3110'],
  [0x0f, 'SITL'],
  [0x10, 'IST8308'],
  [0x11, 'RM3100_OLD'],
  [0x12, 'RM3100'],
  [0x13, 'MMC5883'],
  [0x14, 'AK09918'],
  [0x15, 'AK09915'],
  [0x16, 'QMC5883P'],
  [0x17, 'BMM350'],
  [0x18, 'IIS2MDC'],
  [0x19, 'LIS2MDL']
])

/** Fields of an ArduPilot compass device id. */
export interface CompassDevice {
  /** Sensor type name, "Unknown" if not recognised. */
  readonly name: string
  readonly busType: string
  /** Raw bus type number (3 is DroneCAN). */
  readonly busTypeIndex: number
  readonly bus: number
  readonly address: number
  /** For DroneCAN the device type field holds the sensor id plus one. */
  readonly devtype: number
}

/** Decode a `COMPASS_DEV_ID` value (upstream `decode_devid(ID, DEVICE_TYPE_COMPASS)`). */
export function decodeCompassDevId(id: number): CompassDevice {
  const busTypeIndex = id & 0x07
  const devtype = id >> 16
  return {
    name: COMPASS_TYPES.get(devtype) ?? 'Unknown',
    busType: BUS_TYPES.get(busTypeIndex) ?? 'Unknown',
    busTypeIndex,
    bus: (id >> 3) & 0x1f,
    address: (id >> 8) & 0xff,
    devtype
  }
}

/** One-line description as upstream shows it, e.g. "AK09916 via I2C". */
export function describeCompassDevice(id: number): string {
  const d = decodeCompassDevId(id)
  if (d.busTypeIndex === 3) {
    return `${d.busType} bus: ${d.bus} node id: ${d.address} sensor: ${d.devtype - 1}`
  }
  return `${d.name} via ${d.busType}`
}
