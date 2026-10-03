import { GYRO_AXES, type GyroAxis } from './fft/batch-fft.js'
import type { FilterReviewLog } from './load.js'

/** Which spectrum of a gyro: logged before or after the filters, or estimated from pre-filter data. */
export type SpectrumKind = 'pre' | 'post' | 'est'

/** The three spectrum kinds, in plot order. */
export const SPECTRUM_KINDS: readonly SpectrumKind[] = ['pre', 'post', 'est']

/** Display names of the spectrum kinds. */
export const SPECTRUM_LABELS: Readonly<Record<SpectrumKind, string>> = {
  pre: 'Pre-filter',
  post: 'Post-filter',
  est: 'Estimated post'
}

/** Identifies one FFT plot line: gyro (0..2), spectrum kind and axis. */
export type SpectrumTraceKey = `${number}-${SpectrumKind}-${GyroAxis}`

/** Key of the FFT line for a gyro, kind and axis. */
export function spectrumTraceKey(sensor: number, kind: SpectrumKind, axis: GyroAxis): SpectrumTraceKey {
  return `${sensor}-${kind}-${axis}`
}

/** Trace and plot selections that follow a newly loaded log. */
export interface Selections {
  /** FFT plot lines ticked. */
  readonly shown: ReadonlySet<SpectrumTraceKey>
  /** IMU of the Bode plot. */
  readonly bodeGyro: number
  /** IMU of the spectrogram. */
  readonly specGyro: number
  /** Spectrum of the spectrogram. */
  readonly specKind: SpectrumKind
}

/**
 * Selections upstream `load()` makes: every logged line of the EKF primary IMU (of every IMU
 * when there is no primary with data), plus the estimated post-filter lines when no post-filter
 * data is logged; Bode plot and spectrogram on the primary (else the lowest IMU with data),
 * spectrogram on pre-filter data when there is some.
 */
export function defaultSelections(log: FilterReviewLog): Selections {
  const shown = new Set<SpectrumTraceKey>()
  const primary = log.primaryGyro
  for (const g of log.gyro.instances) {
    if (g === null) continue
    // Only the EKF primary is shown by default when there is one
    const show = !log.primaryFromEkf || g.sensorNum === primary
    if (!show) continue
    for (const axis of GYRO_AXES) {
      shown.add(spectrumTraceKey(g.sensorNum, g.postFilter ? 'post' : 'pre', axis))
      // Show the estimate by default when there is no logged post-filter data
      if (log.havePre && !log.havePost) shown.add(spectrumTraceKey(g.sensorNum, 'est', axis))
    }
  }
  return { shown, bodeGyro: primary, specGyro: primary, specKind: log.havePre ? 'pre' : 'post' }
}
