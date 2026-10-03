import { pageParams } from './param-file.js'
import type { FilterReviewLog } from './load.js'
import type { PageValues } from './page-values.js'
import type { TimeRange } from './time-index.js'

/** Mean tracking values passed to the Filter Tool (upstream `open_in_filter_tool`). */
export interface FilterToolValues {
  /** Gyro sample rate of the IMU shown in the Bode plot (Hz). */
  readonly gyroSampleRate: number | undefined
  readonly throttle: number | undefined
  readonly rpm1: number | undefined
  readonly escRpm: number | undefined
  readonly numMotors: number | undefined
  readonly rpm2: number | undefined
}

/**
 * Filter Tool URL carrying the `INS_*` inputs (their value strings, as upstream appends
 * `item.value`) and the mean tracking values as query parameters, in the order upstream adds
 * them. The Filter Tool has no FFT tracking input.
 */
export function filterToolUrl(base: string, values: PageValues, tracking: FilterToolValues): string {
  const query = new URLSearchParams()
  for (const p of pageParams(values)) query.append(p.name, p.value)
  if (tracking.gyroSampleRate !== undefined) query.append('GYRO_SAMPLE_RATE', String(Math.round(tracking.gyroSampleRate)))
  if (tracking.throttle !== undefined) query.append('Throttle', String(tracking.throttle))
  if (tracking.rpm1 !== undefined) query.append('RPM1', String(tracking.rpm1))
  if (tracking.escRpm !== undefined) {
    query.append('ESC_RPM', String(tracking.escRpm))
    query.append('NUM_MOTORS', String(tracking.numMotors))
  }
  if (tracking.rpm2 !== undefined) query.append('RPM2', String(tracking.rpm2))
  return `${base}?${query.toString()}`
}

/**
 * Tracking values upstream `open_in_filter_tool` reads: the rate of the first instance of the
 * Bode plot's IMU and the mean of each tracking source over the analysis window.
 */
export function filterToolValues(log: FilterReviewLog, bodeGyro: number, range: TimeRange): FilterToolValues {
  const gyro = log.gyro.instances.find((g) => g !== null && g.sensorNum === bodeGyro)
  const t = log.targets
  return {
    gyroSampleRate: gyro?.gyroRate,
    throttle: t.throttle.mean(range),
    rpm1: t.rpm1.mean(range),
    escRpm: t.esc.mean(range),
    numMotors: t.esc.numMotors,
    rpm2: t.rpm2.mean(range)
  }
}
