import type { DataflashLog } from '@apwt/dataflash'
import type { NotchParams } from '../filter-params.js'
import type { FilterVersion } from '../filter-version.js'
import { isInstanced, readField, readSeconds } from './read-series.js'
import { SeriesTarget, type LoggedSeries } from './target.js'

/** `INS_HNTCH_MODE` value tracking RPM sensor 1. */
export const RPM1_MODE = 2
/** `INS_HNTCH_MODE` value tracking RPM sensor 2. */
export const RPM2_MODE = 5

function readRpm(log: DataflashLog, instance: number): LoggedSeries | undefined {
  const msg = 'RPM'
  if (!log.has(msg)) return undefined

  if (isInstanced(log, msg)) {
    // New instance RPM message
    const inst = instance - 1
    if (!log.instances(msg).includes(inst)) return undefined
    const time = readSeconds(log, msg, inst)
    const value = readField(log, msg, 'RPM', inst)
    const health = log.getNumbers(msg, 'H', inst)
    if (time === undefined || value === undefined || health === undefined) return undefined
    // Set RPM to -1 when unhealthy, this maintains behavior with the old logging
    for (let i = 0; i < health.length; i++) {
      if (health[i] === 0) value[i] = -1
    }
    return { time, value }
  }

  // Old log message containing both rpm 1 and 2
  const time = readSeconds(log, msg)
  const value = readField(log, msg, `rpm${instance}`)
  return time === undefined || value === undefined ? undefined : { time, value }
}

/** RPM sensor tracking (upstream `RPMTarget`, `tracking/RPM.js`). */
export class RpmTarget extends SeriesTarget {
  /**
   * @param instance RPM sensor number, 1 or 2.
   * @param modeValue `INS_HNTCH_MODE` value for this sensor.
   */
  constructor(log: DataflashLog, instance: number, modeValue: number) {
    super(`RPM${instance}`, modeValue, readRpm(log, instance))
  }

  override target(config: NotchParams, rpm: number, filterVersion: FilterVersion): number {
    if (config.ref === 0) return config.freq
    const rpmValid = rpm > 0
    const freq = rpm * config.ref * (1.0 / 60.0)
    if (filterVersion >= 2) {
      if (rpmValid) return Math.abs(freq)
      return 0.0
    }
    if (rpmValid) return Math.max(config.freq, freq)
    return config.freq
  }
}
