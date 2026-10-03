import { linearInterp } from '@apwt/signal'
import type { NotchParams } from '../filter-params.js'
import type { FilterVersion } from '../filter-version.js'
import { findEndIndex, findStartIndex, type TimeRange } from '../time-index.js'

/** One tracked frequency over time (Hz against seconds). */
export interface FrequencySeries {
  readonly time: Float64Array
  readonly freq: Float64Array
}

/**
 * Target frequency of a tracking source over the log (upstream `get_target_freq` result).
 * `multi` is set when several peaks / motors are tracked at once (upstream nested arrays).
 */
export interface TargetFrequency {
  readonly multi: boolean
  readonly series: readonly FrequencySeries[]
}

/** Values upstream reads from globals while computing targets. */
export interface TrackingContext {
  /** Selected filter implementation version (upstream `get_filter_version()`). */
  readonly filterVersion: FilterVersion
  /** Start of the gyro data in seconds (upstream `Gyro_batch.start_time`). */
  readonly gyroStartTime: number
  /** End of the gyro data in seconds (upstream `Gyro_batch.end_time`). */
  readonly gyroEndTime: number
}

/** Tracking data resampled onto the FFT window times of one gyro instance. */
export interface InterpolatedTarget {
  /**
   * Notch centre frequencies at FFT window `index`, or `null` when there is no data.
   * Port of upstream `get_interpolated_target_freq`.
   */
  frequencies(index: number, config: NotchParams, filterVersion: FilterVersion): readonly number[] | null
}

/** Whether option bit 1 (multi-source / per-motor tracking) is set. */
export function isMultiSource(config: Pick<NotchParams, 'options'> | undefined): boolean {
  return config !== undefined && (config.options & (1 << 1)) !== 0
}

/**
 * Source of a harmonic notch's centre frequency (upstream `NotchTarget` in
 * `tracking/BaseClass.js`). One subclass per tracking mode.
 */
export abstract class NotchTarget {
  /** Display name, e.g. "ESC". */
  readonly name: string
  /** `INS_HNTCH_MODE` value served by this target, or `null` when it cannot be selected. */
  readonly modeValue: number | null

  protected constructor(name: string, modeValue: number | null) {
    this.name = name
    this.modeValue = modeValue
  }

  /** Whether the log holds data for this target under `config` (upstream `have_data`). */
  abstract haveData(config: NotchParams | undefined, filterVersion: FilterVersion): boolean

  /** Message explaining why an enabled notch has no data (upstream `no_data_error`). */
  noDataError(_config: NotchParams, _filterVersion: FilterVersion): string {
    return 'No tracking data available for ' + this.name + ' notch'
  }

  /** Target frequency across the whole log, or `undefined` without data. */
  abstract targetFrequency(config: NotchParams, context: TrackingContext): TargetFrequency | undefined

  /** Resample onto FFT window times (upstream `interpolate`); `undefined` without data. */
  abstract interpolate(time: ArrayLike<number>): InterpolatedTarget | undefined

  /** Mean raw tracking value over `range` (upstream `get_mean`), `undefined` without data. */
  mean(_range: TimeRange): number | undefined {
    return undefined
  }
}

/** A time series read from one log field. */
export interface LoggedSeries {
  readonly time: Float64Array
  readonly value: Float64Array
}

/**
 * Mean of `value` over `range` (upstream `get_mean_value`). Unlike the plot averages the end
 * index is not incremented, matching upstream.
 */
export function meanOverRange(time: ArrayLike<number>, value: ArrayLike<number>, range: TimeRange): number {
  const startIndex = findStartIndex(time, range.start)
  const endIndex = findEndIndex(time, range.end)
  let mean = 0
  for (let j = startIndex; j < endIndex; j++) mean += value[j]!
  mean /= endIndex - startIndex
  return mean
}

/**
 * Behaviour shared by targets that track one logged value through a per-sample mapping
 * (upstream `BaseClass` defaults used by RPM, and the averaged paths of Throttle and FFT).
 */
export abstract class SeriesTarget extends NotchTarget {
  /** Logged source values, or `undefined` when the log lacks them. */
  protected readonly series: LoggedSeries | undefined

  protected constructor(name: string, modeValue: number | null, series: LoggedSeries | undefined) {
    super(name, modeValue)
    this.series = series
  }

  /** Map one logged value to a notch frequency (upstream `get_target`). */
  abstract target(config: NotchParams, value: number, filterVersion: FilterVersion): number

  override haveData(_config: NotchParams | undefined, _filterVersion: FilterVersion): boolean {
    return this.series !== undefined
  }

  /** Upstream `BaseClass.get_target_freq`: a flat line at `_FREQ` when `_REF` is 0. */
  override targetFrequency(config: NotchParams, context: TrackingContext): TargetFrequency | undefined {
    const series = this.series
    if (!this.haveData(config, context.filterVersion) || series === undefined) return undefined
    if (config.ref === 0) {
      return single(
        Float64Array.of(series.time[0]!, series.time[series.time.length - 1]!),
        Float64Array.of(config.freq, config.freq)
      )
    }
    return single(
      series.time,
      mapValues(series.value, (v) => this.target(config, v, context.filterVersion))
    )
  }

  override interpolate(time: ArrayLike<number>): InterpolatedTarget | undefined {
    const series = this.series
    if (series === undefined) return undefined
    const values = linearInterp(series.value, series.time, time)
    return {
      frequencies: (index, config, version) => (values.length === 0 ? null : [this.target(config, values[index]!, version)])
    }
  }

  override mean(range: TimeRange): number | undefined {
    return this.series === undefined ? undefined : meanOverRange(this.series.time, this.series.value, range)
  }
}

/** Single-series {@link TargetFrequency}. */
export function single(time: Float64Array, freq: Float64Array): TargetFrequency {
  return { multi: false, series: [{ time, freq }] }
}

/** Apply `fn` to every element. */
export function mapValues(values: ArrayLike<number>, fn: (v: number) => number): Float64Array {
  const out = new Float64Array(values.length)
  for (let i = 0; i < values.length; i++) out[i] = fn(values[i]!)
  return out
}
