import { decodeDevId, DeviceType } from '@apwt/ardupilot'
import type { DataflashLog } from '@apwt/dataflash'
import { arrayMean } from '@apwt/signal'
import { MAX_GYROS } from './constants.js'
import type { GyroSensor } from './gyro-data.js'

/** Configured gyros and their mean rates, as read at the start of upstream `load()`. */
export interface GyroSensors {
  /** Number of gyros with a non-zero device id. */
  readonly numGyro: number
  /** Mean logged sample rate per IMU number (sparse). */
  readonly gyroRate: readonly (number | undefined)[]
  readonly sensors: readonly GyroSensor[]
}

/** Device id parameter name for IMU `i`. */
export function gyroIdParam(i: number): string {
  return i === 0 ? 'INS_GYR_ID' : `INS_GYR${i + 1}_ID`
}

/** Decode configured gyros from `INS_GYRn_ID` and their rates from `IMU.GHz`. */
export function readGyroSensors(log: DataflashLog): GyroSensors {
  let numGyro = 0
  const gyroRate: (number | undefined)[] = []
  const sensors: GyroSensor[] = []
  const imuInstances = log.instances('IMU')
  for (let i = 0; i < MAX_GYROS; i++) {
    const id = log.param(gyroIdParam(i))
    if (id === undefined || !(id > 0)) continue
    let rate: number | undefined
    if (imuInstances.includes(i)) {
      // Assume constant rate, this is not actually true, but variable rate breaks FFT averaging.
      const ghz = log.getNumbers('IMU', 'GHz', i)
      if (ghz !== undefined) rate = arrayMean(ghz)
    }
    gyroRate[i] = rate
    sensors.push({ index: i, deviceId: id, rate })
    numGyro++
  }
  return { numGyro, gyroRate, sensors }
}

/**
 * Gyro description as upstream `load()` writes it: `"ICM42688 via SPI at 2000 Hz"`, with `?` for
 * an unknown rate. Upstream uses the IMU table name and bus for every bus type, DroneCAN
 * included, rather than the DroneCAN node form of `describeDevId`.
 */
export function gyroInfoText(sensor: GyroSensor): string {
  const decoded = decodeDevId(sensor.deviceId, DeviceType.imu)
  const rate = sensor.rate === undefined ? '?' : Math.round(sensor.rate)
  return `${decoded.name} via ${decoded.busType} at ${rate} Hz`
}
