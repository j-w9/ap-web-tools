import { MAX_NUM_HARMONICS } from '../constants.js'
import type { HarmonicNotchFilter } from '../filters/harmonic-notch.js'
import type { TimeRange } from '../time-index.js'
import type { LoggedNotch } from '../tracking/logged.js'
import type { FrequencySeries, TargetFrequency, TrackingContext } from '../tracking/target.js'
import { windowRange } from './spectrum.js'

/** Mean and range of a tracked frequency over the selected time range. */
export interface FrequencyStats {
  readonly mean: number
  /** `NaN` when the range holds no samples (upstream `null`). */
  readonly min: number
  readonly max: number
}

function seriesStats(series: FrequencySeries, harmonic: number, lowerLimit: number, range: TimeRange): FrequencyStats {
  const { start, end } = windowRange(series.time, range)
  let mean = 0
  let min: number | null = null
  let max: number | null = null
  for (let j = start; j < end; j++) {
    const freq = Math.max(series.freq[j]! * harmonic, lowerLimit)
    mean += freq
    if (min === null || freq < min) min = freq
    if (max === null || freq > max) max = freq
  }
  mean /= end - start
  return { mean, min: min ?? NaN, max: max ?? NaN }
}

/**
 * Mean / min / max of one harmonic of a target over `range`, clamped below at `lowerLimit`
 * (upstream `get_stats` in `redraw()`). Multiple peaks are averaged and their ranges merged.
 */
export function harmonicStats(target: TargetFrequency, harmonic: number, lowerLimit: number, range: TimeRange): FrequencyStats {
  if (!target.multi) return seriesStats(target.series[0]!, harmonic, lowerLimit, range)
  // Combine multiple peaks
  let mean = 0
  let min: number | null = null
  let max: number | null = null
  for (const series of target.series) {
    const s = seriesStats(series, harmonic, lowerLimit, range)
    mean += s.mean
    if (min === null || s.min < min) min = s.min
    if (max === null || s.max > max) max = s.max
  }
  mean /= target.series.length
  return { mean, min: min ?? NaN, max: max ?? NaN }
}

/** FFT plot marker for one harmonic: a line at the mean and a band from min to max (Hz). */
export interface HarmonicMarker extends FrequencyStats {
  /** Harmonic number, 1 for the fundamental. */
  readonly harmonic: number
}

/** Markers for every enabled harmonic of a notch; empty when the notch is disabled. */
export function notchMarkers(filter: HarmonicNotchFilter, context: TrackingContext, range: TimeRange): HarmonicMarker[] {
  if (!filter.enabled) return []
  const fundamental = filter.targetFrequency(context)
  if (fundamental === undefined) return []
  const out: HarmonicMarker[] = []
  for (let j = 0; j < MAX_NUM_HARMONICS; j++) {
    if ((filter.harmonics & (1 << j)) === 0) continue
    const harmonic = j + 1
    out.push({ harmonic, ...harmonicStats(fundamental, harmonic, filter.minFreq(harmonic), range) })
  }
  return out
}

/** One line on the spectrogram (Hz against seconds, NaN separates peaks). */
export interface TrackingLine {
  readonly harmonic: number
  readonly time: Float64Array
  readonly freq: Float64Array
}

/**
 * Flatten a target into one polyline; multiple peaks are concatenated with a NaN after each
 * to break the line (upstream `build_plot_array`).
 */
export function flattenTarget(target: TargetFrequency): FrequencySeries {
  if (!target.multi) return target.series[0] ?? { time: new Float64Array(0), freq: new Float64Array(0) }
  let length = 0
  for (const s of target.series) length += s.time.length + 1
  const time = new Float64Array(length)
  const freq = new Float64Array(length)
  let pos = 0
  for (const s of target.series) {
    time.set(s.time, pos)
    freq.set(s.freq, pos)
    pos += s.time.length
    // Add NAN to remove line from end back to the start
    time[pos] = NaN
    freq[pos] = NaN
    pos++
  }
  return { time, freq }
}

function harmonicLines(target: TargetFrequency, harmonics: number, minFreq: (harmonic: number) => number): TrackingLine[] {
  const flat = flattenTarget(target)
  const out: TrackingLine[] = []
  for (let j = 0; j < MAX_NUM_HARMONICS; j++) {
    if ((harmonics & (1 << j)) === 0) continue
    const harmonic = j + 1
    const lower = minFreq(harmonic)
    const freq = new Float64Array(flat.freq.length)
    for (let n = 0; n < freq.length; n++) freq[n] = Math.max(flat.freq[n]! * harmonic, lower)
    out.push({ harmonic, time: flat.time, freq })
  }
  return out
}

/** Spectrogram tracking lines of every enabled harmonic of a notch, clamped at its minimum frequency. */
export function notchTrackingLines(filter: HarmonicNotchFilter, context: TrackingContext): TrackingLine[] {
  if (!filter.enabled) return []
  const fundamental = filter.targetFrequency(context)
  if (fundamental === undefined) return []
  return harmonicLines(fundamental, filter.harmonics, (h) => filter.minFreq(h))
}

/** Spectrogram lines of the frequencies the firmware logged for a notch (no minimum clamp). Upstream only draws them while that notch is enabled. */
export function loggedNotchLines(logged: LoggedNotch): TrackingLine[] {
  const fundamental = logged.targetFrequency()
  if (fundamental === undefined || logged.harmonics === null) return []
  // Upstream scales without a lower limit; -Infinity leaves every value (and NaN) untouched
  return harmonicLines(fundamental, logged.harmonics, () => -Infinity)
}
