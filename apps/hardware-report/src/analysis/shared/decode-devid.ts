/**
 * Sensor device id decoding (IMU, compass, baro, airspeed).
 *
 * Port of upstream `Libraries/DecodeDevID.js` (itself a translation of ArduPilot's
 * `Tools/scripts/decode_devid.py`). Candidate for a shared package: several upstream tools
 * use it.
 *
 * Name strings are copied verbatim, including upstream quirks such as the trailing space in
 * `"AK8963 "` and the `"IMU: "` class label, so output matches the upstream tools exactly.
 */

/** Sensor class a device id belongs to; selects the device-name table. */
export const DeviceType = {
  compass: 0,
  imu: 1,
  baro: 2,
  airspeed: 3
} as const

/** One of the {@link DeviceType} values. */
export type DeviceType = (typeof DeviceType)[keyof typeof DeviceType]

/** Bus type index for DroneCAN devices, whose devtype field holds a sensor id instead. */
export const BUS_TYPE_DRONECAN = 3

const busTypes: Readonly<Record<number, string>> = {
  1: 'I2C',
  2: 'SPI',
  3: 'DRONECAN',
  4: 'SITL',
  5: 'MSP',
  6: 'SERIAL'
}

const compassTypes: Readonly<Record<number, string>> = {
  0x01: 'HMC5883_OLD',
  0x07: 'HMC5883',
  0x02: 'LSM303D',
  0x04: 'AK8963 ',
  0x05: 'BMM150 ',
  0x06: 'LSM9DS1',
  0x08: 'LIS3MDL',
  0x09: 'AK09916',
  0x0a: 'IST8310',
  0x0b: 'ICM20948',
  0x0c: 'MMC3416',
  0x0d: 'QMC5883L',
  0x0e: 'MAG3110',
  0x0f: 'SITL',
  0x10: 'IST8308',
  0x11: 'RM3100_OLD',
  0x12: 'RM3100',
  0x13: 'MMC5883',
  0x14: 'AK09918',
  0x15: 'AK09915',
  0x16: 'QMC5883P',
  0x17: 'BMM350',
  0x18: 'IIS2MDC',
  0x19: 'LIS2MDL'
}

const imuTypes: Readonly<Record<number, string>> = {
  0x09: 'BMI160',
  0x10: 'L3G4200D',
  0x11: 'ACC_LSM303D',
  0x12: 'ACC_BMA180',
  0x13: 'ACC_MPU6000',
  0x16: 'ACC_MPU9250',
  0x17: 'ACC_IIS328DQ',
  0x21: 'GYR_MPU6000',
  0x22: 'GYR_L3GD20',
  0x24: 'GYR_MPU9250',
  0x25: 'GYR_I3G4250D',
  0x26: 'GYR_LSM9DS1',
  0x27: 'ICM20789',
  0x28: 'ICM20689',
  0x29: 'BMI055',
  0x2a: 'SITL',
  0x2b: 'BMI088',
  0x2c: 'ICM20948',
  0x2d: 'ICM20648',
  0x2e: 'ICM20649',
  0x2f: 'ICM20602',
  0x30: 'ICM20601',
  0x31: 'ADIS1647x',
  0x32: 'SERIAL',
  0x33: 'ICM40609',
  0x34: 'ICM42688',
  0x35: 'ICM42605',
  0x36: 'ICM40605',
  0x37: 'IIM42652',
  0x38: 'BMI270',
  0x39: 'BMI085',
  0x3a: 'ICM42670',
  0x3b: 'ICM45686',
  0x3c: 'SCHA63T',
  0x3d: 'IIM42653',
  0x3e: 'LSM6DSV',
  0x3f: 'ASM330'
}

const baroTypes: Readonly<Record<number, string>> = {
  0x01: 'SITL',
  0x02: 'BMP085',
  0x03: 'BMP280',
  0x04: 'BMP388',
  0x05: 'DPS280',
  0x06: 'DPS310',
  0x07: 'FBM320',
  0x08: 'ICM20789',
  0x09: 'KELLERLD',
  0x0a: 'LPS2XH',
  0x0b: 'MS5611',
  0x0c: 'SPL06',
  0x0d: 'DRONECAN',
  0x0e: 'MSP',
  0x0f: 'ICP101XX',
  0x10: 'ICP201XX',
  0x11: 'MS5607',
  0x12: 'MS5837_30BA',
  0x13: 'MS5637',
  0x14: 'BMP390',
  0x15: 'BMP581',
  0x16: 'SPA06',
  0x17: 'AUAV',
  0x18: 'MS5837_02BA'
}

const airspeedTypes: Readonly<Record<number, string>> = {
  0x01: 'SITL',
  0x02: 'MS4525',
  0x03: 'MS5525',
  0x04: 'DLVR',
  0x05: 'MSP',
  0x06: 'SDP3X',
  0x07: 'DRONECAN',
  0x08: 'ANALOG',
  0x09: 'NMEA',
  0x0a: 'ASP5033',
  0x0b: 'AUAV'
}

const classes: Readonly<Record<DeviceType, { label: string; table: Readonly<Record<number, string>> }>> = {
  [DeviceType.compass]: { label: 'Compass', table: compassTypes },
  [DeviceType.imu]: { label: 'IMU: ', table: imuTypes },
  [DeviceType.baro]: { label: 'Baro', table: baroTypes },
  [DeviceType.airspeed]: { label: 'Airspeed', table: airspeedTypes }
}

function lookup(table: Readonly<Record<number, string>>, index: number): string {
  return table[index] ?? 'Unknown'
}

/** Fields common to every decoded device id. */
interface DecodedDevIdBase {
  /** Sensor class label from upstream (`"Compass"`, `"IMU: "`, `"Baro"`, `"Airspeed"`). */
  readonly type: string
  /** Bus name such as `"SPI"`, or `"Unknown"`. */
  readonly busType: string
  /** Raw bus type (bits 0-2). */
  readonly busTypeIndex: number
  /** Bus number (bits 3-7); the CAN driver for DroneCAN devices. */
  readonly bus: number
  /** Bus address (bits 8-15); the node id for DroneCAN devices. */
  readonly address: number
  /** Device name from the class table, or `"Unknown"`. */
  readonly name: string
}

/** A device on a local bus (I2C, SPI, SITL, ...). */
export interface LocalDevId extends DecodedDevIdBase {
  /** Discriminant. */
  readonly kind: 'local'
  /** Device type (bits 16+). */
  readonly devtype: number
}

/** A DroneCAN device: the devtype field encodes the sensor id plus one. */
export interface DroneCanDevId extends DecodedDevIdBase {
  /** Discriminant. */
  readonly kind: 'dronecan'
  /** Sensor index on the node (devtype - 1). */
  readonly sensorId: number
}

/** Result of {@link decodeDevId}. */
export type DecodedDevId = LocalDevId | DroneCanDevId

/**
 * Split a sensor device id into bus type, bus, address and device type and name it.
 * Upstream `decode_devid(ID, type)`; bit operations are identical (including the signed
 * `>> 16`), so ids are coerced to int32 just as in JavaScript upstream.
 */
export function decodeDevId(id: number, type: DeviceType): DecodedDevId {
  const busTypeIndex = id & 0x07
  const bus = (id >> 3) & 0x1f
  const address = (id >> 8) & 0xff
  const devtype = id >> 16

  const cls = classes[type]
  const base = {
    type: cls.label,
    busType: lookup(busTypes, busTypeIndex),
    busTypeIndex,
    bus,
    address,
    name: lookup(cls.table, devtype)
  }
  if (busTypeIndex === BUS_TYPE_DRONECAN) {
    return { kind: 'dronecan', ...base, sensorId: devtype - 1 }
  }
  return { kind: 'local', ...base, devtype }
}
