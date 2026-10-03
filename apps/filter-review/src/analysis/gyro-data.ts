/** One continuous run of gyro samples. */
export interface GyroBatch {
  /** Time of the first sample (s). */
  readonly sampleTime: number
  /** Sample rate of this batch (Hz). */
  readonly sampleRate: number
  readonly x: Float64Array
  readonly y: Float64Array
  readonly z: Float64Array
}

/** All batches of one logged gyro instance (upstream `Gyro_batch[i]`). */
export interface GyroInstance {
  /** Logged instance number (index into `GyroData.instances`). */
  readonly index: number
  readonly batches: readonly GyroBatch[]
  /** Physical IMU number (0..2). */
  readonly sensorNum: number
  /** True if the data was logged after the filters. */
  readonly postFilter: boolean
  /** Best estimate of the gyro sample rate (Hz). */
  readonly gyroRate: number
}

/** Where the gyro samples came from. */
export type GyroLogType = 'batch' | 'raw'

/** Gyro data loaded from a log (upstream `Gyro_batch`). */
export interface GyroData {
  readonly type: GyroLogType
  /** Quantisation noise floor of the logged samples (rad/s). */
  readonly quantizationNoise: number
  /** Indexed by logged instance number; `null` where an instance is missing or unusable. */
  readonly instances: readonly (GyroInstance | null)[]
  /** Earliest batch start (s), `undefined` if there is no data. */
  readonly startTime: number | undefined
  /** Latest batch end (s), `undefined` if there is no data. */
  readonly endTime: number | undefined
}

/** Sensors and sample rates read from parameters and IMU messages. */
export interface GyroSensor {
  /** IMU number (0..2). */
  readonly index: number
  /** `INS_GYR_ID` style device id. */
  readonly deviceId: number
  /** Mean `IMU.GHz` for this IMU, when logged. */
  readonly rate: number | undefined
}

/** The non-null instances of a {@link GyroData}. */
export function presentInstances(gyro: GyroData): GyroInstance[] {
  return gyro.instances.filter((g): g is GyroInstance => g !== null)
}
