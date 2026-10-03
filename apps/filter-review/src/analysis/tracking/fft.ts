import type { DataflashLog } from '@apwt/dataflash'
import { linearInterp } from '@apwt/signal'
import type { NotchParams } from '../filter-params.js'
import type { FilterVersion } from '../filter-version.js'
import type { TimeRange } from '../time-index.js'
import { isInstanced, readSeconds, readSeries } from './read-series.js'
import {
  NotchTarget,
  isMultiSource,
  mapValues,
  meanOverRange,
  single,
  type FrequencySeries,
  type InterpolatedTarget,
  type LoggedSeries,
  type TargetFrequency,
  type TrackingContext
} from './target.js'

/** `INS_HNTCH_MODE` value tracking the onboard gyro FFT. */
export const FFT_MODE = 4

/**
 * Energy-weighted peak frequency from the X and Y axes, as `get_weighted_freq_hz` in AP_GyroFFT.
 */
export function weightedPeakFrequency(energyX: number, energyY: number, freqX: number, freqY: number): number {
  if (energyX > 0 && energyY > 0) {
    // Weighted by relative energy
    return (freqX * energyX + freqY * energyY) / (energyX + energyY)
  }
  // Just take average
  return (freqX + freqY) * 0.5
}

function readPeaks(log: DataflashLog): FrequencySeries[] {
  const msg = 'FTN2'
  const peaks: FrequencySeries[] = []
  if (!log.has(msg) || !isInstanced(log, msg)) return peaks
  // FFT can track three peaks
  for (const inst of log.instances(msg)) {
    const time = readSeconds(log, msg, inst)
    const energyX = log.getNumbers(msg, 'EnX', inst)
    const energyY = log.getNumbers(msg, 'EnY', inst)
    const freqX = log.getNumbers(msg, 'PkX', inst)
    const freqY = log.getNumbers(msg, 'PkY', inst)
    if (time === undefined || !energyX || !energyY || !freqX || !freqY) continue
    const freq = new Float64Array(time.length)
    for (let j = 0; j < time.length; j++) {
      freq[j] = weightedPeakFrequency(energyX[j]!, energyY[j]!, freqX[j]!, freqY[j]!)
    }
    peaks.push({ time, freq })
  }
  return peaks
}

/** Onboard FFT tracking (upstream `FFTTarget`, `tracking/FFT.js`). */
export class FftTarget extends NotchTarget {
  /** Averaged centre peak, `FTN1.PkAvg`. */
  readonly center: LoggedSeries | undefined
  /** Individually tracked peaks from `FTN2`, one per instance. */
  readonly peaks: readonly FrequencySeries[]

  constructor(log: DataflashLog) {
    super('FFT', FFT_MODE)
    this.center = readSeries(log, 'FTN1', 'PkAvg')
    this.peaks = readPeaks(log)
  }

  /** Notch frequency for one peak frequency. */
  target(config: NotchParams, freq: number, filterVersion: FilterVersion): number {
    if (config.ref === 0) return config.freq
    if (filterVersion >= 2) return Math.abs(freq)
    return Math.max(freq, config.freq)
  }

  override haveData(): boolean {
    return this.center !== undefined || this.peaks.length > 0
  }

  override targetFrequency(config: NotchParams, context: TrackingContext): TargetFrequency | undefined {
    const map = (f: number): number => this.target(config, f, context.filterVersion)
    if (isMultiSource(config)) {
      if (!this.haveData()) return undefined
      // Tracking multiple peaks
      return { multi: true, series: this.peaks.map((p) => ({ time: p.time, freq: mapValues(p.freq, map) })) }
    }
    // Just center peak (upstream would throw when only FTN2 is logged)
    if (this.center === undefined) return undefined
    return single(this.center.time, mapValues(this.center.value, map))
  }

  /**
   * Upstream returns no frequencies at all when `FTN2` is absent, even for the averaged
   * `FTN1` peak, because it tests the length of the per-peak array; preserved here.
   */
  override interpolate(time: ArrayLike<number>): InterpolatedTarget | undefined {
    if (!this.haveData()) return undefined
    // Upstream interpolates the FTN1 peak unconditionally and throws (TypeError on undefined
    // data) when only FTN2 is logged, which stops the calculation; reported the same way here.
    if (this.center === undefined) {
      throw new TypeError('FFT tracking: FTN2 is logged without FTN1; the original tool stops with an error here')
    }
    const perPeak = this.peaks.map((p) => linearInterp(p.freq, p.time, time))
    const center = linearInterp(this.center.value, this.center.time, time)
    return {
      frequencies: (index, config, version) => {
        if (perPeak.length === 0) return null
        if (isMultiSource(config)) return perPeak.map((p) => this.target(config, p[index]!, version))
        return [this.target(config, center[index]!, version)]
      }
    }
  }

  override mean(range: TimeRange): number | undefined {
    return this.center === undefined ? undefined : meanOverRange(this.center.time, this.center.value, range)
  }
}
