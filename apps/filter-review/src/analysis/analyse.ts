import { arrayFromRange, type ComplexArray } from '@apwt/signal'
import { MAX_GYROS } from './constants.js'
import { runGyroFft, type FftWindowOptions, type GyroFft } from './fft/batch-fft.js'
import type { TrackingInterpolation } from './filters/harmonic-notch.js'
import { transferFunctions, type FilterSet } from './filters/filter-set.js'
import { zGrid, type ZGrid } from '@apwt/filters'
import type { GyroData, GyroInstance } from './gyro-data.js'
import type { NotchTarget } from './tracking/target.js'

/** Frequency step of the high resolution Bode grid; small steps keep the phase unwrap correct. */
export const BODE_FREQ_STEP = 0.05

/** High resolution frequency grid used for the Bode plot. */
export interface BodeGrid {
  readonly freq: Float64Array
  readonly grid: ZGrid
}

/** FFT and filter-simulation inputs for one gyro instance (upstream `Gyro_batch[i].FFT`). */
export interface InstanceAnalysis {
  readonly instance: GyroInstance
  readonly fft: GyroFft
  /** z^-1 / z^-2 on the FFT bins; only for pre-filter data (used to estimate post-filter). */
  readonly grid: ZGrid | undefined
  /** Bode grid; only for pre-filter data. */
  readonly bode: BodeGrid | undefined
  /** Tracking data interpolated to the FFT window times; only for pre-filter data. */
  readonly tracking: TrackingInterpolation | undefined
}

/** Result of {@link analyseGyro}. */
export interface GyroAnalysis {
  /** Indexed like `GyroData.instances`. */
  readonly instances: readonly (InstanceAnalysis | null)[]
  /** Set when no instance produced a single FFT window (upstream alert). */
  readonly warning: string | undefined
}

/** Resample every tracking target onto `time`. */
export function interpolateTargets(targets: readonly NotchTarget[], time: ArrayLike<number>): TrackingInterpolation {
  return new Map(targets.map((t) => [t, t.interpolate(time)]))
}

/** Bode frequency grid from 0 to the last FFT bin (upstream `calculate()`). */
export function bodeGrid(fft: GyroFft): BodeGrid {
  const maxFreq = fft.bins[fft.bins.length - 1]!
  const freq = arrayFromRange(0, maxFreq, BODE_FREQ_STEP)
  return { freq, grid: zGrid(freq, fft.averageSampleRate) }
}

/**
 * Run the FFT of every gyro instance and prepare the filter simulation inputs
 * (upstream `calculate()`). Throws if the window size is not a power of two.
 */
export function analyseGyro(gyro: GyroData, targets: readonly NotchTarget[], options: FftWindowOptions = {}): GyroAnalysis {
  let validCount = 0
  const ffts = gyro.instances.map((inst) => {
    if (inst === null) return null
    const fft = runGyroFft(inst.batches, gyro.type, options)
    validCount += fft.x.length
    return fft
  })
  const havePost = gyro.instances.some((i) => i?.postFilter === true)

  const instances = gyro.instances.map((instance, i): InstanceAnalysis | null => {
    const fft = ffts[i]
    if (instance === null || fft == null) return null
    const grid = instance.postFilter ? undefined : zGrid(fft.bins, fft.averageSampleRate)
    const pre = !instance.postFilter || !havePost
    return {
      instance,
      fft,
      grid,
      bode: pre ? bodeGrid(fft) : undefined,
      tracking: pre ? interpolateTargets(targets, fft.time) : undefined
    }
  })
  return { instances, warning: validCount === 0 ? 'Not enough continuous IMU data available' : undefined }
}

/** Simulated filter response of one instance (upstream `FFT.H` and `FFT.bode.H`). */
export interface InstanceTransfer {
  /** H on the FFT bins at each window, for the post-filter estimate. */
  readonly fft: ComplexArray[] | undefined
  /** H on the Bode grid at each window. */
  readonly bode: ComplexArray[] | undefined
}

/** Evaluate the filter chain for one analysed instance (upstream `calculate_transfer_function`). */
export function instanceTransfer(analysis: InstanceAnalysis, filters: FilterSet): InstanceTransfer {
  const { fft, tracking } = analysis
  const interp: TrackingInterpolation = tracking ?? new Map()
  const n = fft.time.length
  const rate = fft.averageSampleRate
  return {
    fft: analysis.grid === undefined ? undefined : transferFunctions(filters, interp, n, rate, analysis.grid),
    bode: analysis.bode === undefined ? undefined : transferFunctions(filters, interp, n, rate, analysis.bode.grid)
  }
}

/** FFT summary for one IMU: mean sample rate and resolution over its instances. */
export interface SensorFftInfo {
  readonly sampleRate: number
  readonly windowSize: number
  /** Frequency resolution (Hz per bin). */
  readonly resolution: number
}

/** Per-IMU FFT info shown next to each gyro (upstream `calculate()` info text). */
export function sensorFftInfo(analysis: GyroAnalysis): (SensorFftInfo | undefined)[] {
  const out: (SensorFftInfo | undefined)[] = []
  for (let i = 0; i < MAX_GYROS; i++) {
    let sampleRate = 0
    let windowSize = 0
    let count = 0
    for (const a of analysis.instances) {
      if (a === null || a.instance.sensorNum !== i) continue
      sampleRate += a.fft.averageSampleRate
      windowSize += a.fft.windowSize
      count++
    }
    if (count === 0) {
      out.push(undefined)
      continue
    }
    sampleRate /= count
    windowSize /= count
    out.push({ sampleRate, windowSize, resolution: sampleRate / windowSize })
  }
  return out
}
