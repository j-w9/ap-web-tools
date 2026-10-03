import { pageParams } from './param-file.js'
import type { FilterParams } from './filter-params.js'

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
 * Filter Tool URL carrying the current filter settings and mean tracking values as query
 * parameters, in the order upstream adds them. The Filter Tool has no FFT tracking input.
 */
export function filterToolUrl(base: string, params: FilterParams, sixteenHarmonics: boolean, values: FilterToolValues): string {
  const query = new URLSearchParams()
  for (const p of pageParams(params, sixteenHarmonics)) query.append(p.name, String(p.value))
  if (values.gyroSampleRate !== undefined) query.append('GYRO_SAMPLE_RATE', String(Math.round(values.gyroSampleRate)))
  if (values.throttle !== undefined) query.append('Throttle', String(values.throttle))
  if (values.rpm1 !== undefined) query.append('RPM1', String(values.rpm1))
  if (values.escRpm !== undefined) {
    query.append('ESC_RPM', String(values.escRpm))
    query.append('NUM_MOTORS', String(values.numMotors ?? ''))
  }
  if (values.rpm2 !== undefined) query.append('RPM2', String(values.rpm2))
  return `${base}?${query.toString()}`
}
