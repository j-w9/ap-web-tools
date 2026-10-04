import { DataflashLog } from '@apwt/dataflash'
import { defaultTimeRange, readFlightData, type DefaultTimeRange, type FlightData } from './flight-data.js'
import { hasSixteenHarmonics, unsignedBitmask } from './filter-params.js'
import { readFilterVersion, type FilterVersion } from './filter-version.js'
import type { GyroData, GyroSensor } from './gyro-data.js'
import { readGyroSensors } from './gyro-sensors.js'
import { loadFromBatch, type GyroLoadContext } from './load-batch.js'
import { loadFromRaw } from './load-raw.js'
import type { LoggedNotch } from './tracking/logged.js'
import type { TrackingContext } from './tracking/target.js'
import { createLoggedNotches, createTrackingTargets, type TrackingTargets } from './tracking/targets.js'

/** Everything Filter Review needs from a log. */
export interface FilterReviewLog {
  readonly gyro: GyroData & { readonly startTime: number; readonly endTime: number }
  /** Whether batch and raw gyro data are present. */
  readonly available: { readonly batch: boolean; readonly raw: boolean }
  readonly sensors: readonly GyroSensor[]
  readonly numGyro: number
  readonly filterVersion: FilterVersion
  /** Whether `_HMNCS` is a 32-bit (16 harmonic) bitmask rather than 8-bit. */
  readonly sixteenHarmonics: boolean
  readonly targets: TrackingTargets
  readonly loggedNotches: readonly [LoggedNotch, LoggedNotch]
  readonly flight: FlightData
  readonly timeRange: DefaultTimeRange
  /** IMU to show by default: the EKF3 primary when it has data, else the lowest IMU with data. */
  readonly primaryGyro: number
  /** True when `primaryGyro` came from `EK3_PRIMARY` and it has data (only it is shown by default). */
  readonly primaryFromEkf: boolean
  /** `EK3_PRIMARY` when EKF3 is in use, whether or not that IMU has data (upstream labels it "Primary"). */
  readonly ekfPrimary: number | undefined
  readonly havePre: boolean
  readonly havePost: boolean
  /** Non-fatal problems (upstream alerts and console messages). */
  readonly warnings: readonly string[]
}

/** {@link TrackingContext} for a loaded log at a filter version. */
export function trackingContext(log: FilterReviewLog, filterVersion: FilterVersion = log.filterVersion): TrackingContext {
  return { filterVersion, gyroStartTime: log.gyro.startTime, gyroEndTime: log.gyro.endTime }
}

/**
 * Parse a log and extract gyro data, filter parameters and notch tracking sources (the
 * analysis part of upstream `load()`). `preferBatch` is the "Batch" log type choice, used when the
 * log has both batch and raw data. Throws an `Error` with a user-facing message when the log
 * cannot be used.
 */
export function loadFilterReviewLog(input: ArrayBuffer | Uint8Array | DataflashLog, preferBatch = false): FilterReviewLog {
  const log = input instanceof DataflashLog ? input : DataflashLog.parse(input)
  const warnings: string[] = []
  const warn = (message: string): void => {
    warnings.push(message)
  }

  if (!log.has('PARM')) throw new Error('No params in log')

  // Try and decode device IDs and rate
  const { numGyro, gyroRate, sensors } = readGyroSensors(log)

  // Check for some data that we can use
  const haveBatch = log.has('ISBH') && log.has('ISBD')
  const haveRaw = log.has('GYR')
  if (!haveBatch && !haveRaw) throw new Error('No batch data or raw IMU found in log')
  // Have both, use selected. Proven upstream bug fixed (docs/bug-proofs/filter-review.md, row 1):
  // upstream's `reset()` ticks "Raw sensor" before `load()` reads the "Batch" radio, so the choice
  // was never used; here the choice made before loading is the one used.
  const useBatch = haveBatch && (!haveRaw || preferBatch)

  const ctx: GyroLoadContext = { numGyro, gyroRate, warn }
  const gyro = useBatch ? loadFromBatch(log, ctx) : loadFromRaw(log, ctx)

  // May have log messages but nothing in them
  if (gyro === null || gyro.startTime === undefined || gyro.endTime === undefined) {
    throw new Error('No valid gyro data found in log')
  }
  const { startTime, endTime } = gyro

  const version = readFilterVersion(log)
  if (version.warning !== undefined) warn(version.warning)

  const targets = createTrackingTargets(log)
  const loggedNotches = createLoggedNotches(log)
  // Use original harmonics value for logged notches: `_HMNCS` from the log, or the `reset()`
  // default of 3, read through the bitmask width of this log
  const sixteenHarmonics = hasSixteenHarmonics(log)
  loggedNotches.forEach((logged, i) => {
    const name = i === 0 ? 'INS_HNTCH_HMNCS' : 'INS_HNTC2_HMNCS'
    logged.harmonics = unsignedBitmask(log.param(name) ?? 3, sixteenHarmonics ? 32 : 8)
  })

  const flight = readFlightData(log)

  // Try and work out which is the primary sensor
  let primary: number | null = 0
  let primaryFromEkf = false
  const ekfType = log.param('AHRS_EKF_TYPE')
  const ek3Primary = log.param('EK3_PRIMARY')
  if (ekfType === 3 && ek3Primary !== undefined && ek3Primary >= 0 && ek3Primary <= 2) {
    primary = ek3Primary
    primaryFromEkf = true
  }
  const present = gyro.instances.filter((g) => g !== null)
  // Make sure we have data for the primary sensor
  if (!present.some((g) => g.sensorNum === primary)) primary = null

  let firstGyro: number | undefined
  let havePre = false
  let havePost = false
  for (const g of present) {
    if (firstGyro === undefined || g.sensorNum < firstGyro) firstGyro = g.sensorNum
    if (g.postFilter) havePost = true
    else havePre = true
  }

  return {
    gyro: { ...gyro, startTime, endTime },
    available: { batch: haveBatch, raw: haveRaw },
    sensors,
    numGyro,
    filterVersion: version.version,
    sixteenHarmonics,
    targets,
    loggedNotches,
    flight,
    timeRange: defaultTimeRange(startTime, endTime, flight.throttle),
    primaryGyro: primary ?? firstGyro ?? 0,
    primaryFromEkf: primaryFromEkf && primary !== null,
    ekfPrimary: primaryFromEkf ? ek3Primary : undefined,
    havePre,
    havePost,
    warnings
  }
}
