import {
  RealFft,
  arrayOffset,
  arrayScale,
  complexAbs,
  hanning,
  isPowerOfTwo,
  rfftFreq,
  runFft,
  windowCorrectionFactors,
  type WindowCorrection
} from '@apwt/signal'
import type { GyroBatch, GyroLogType } from '../gyro-data.js'

/** Upstream hard-codes 50 % overlap between FFT windows. */
export const WINDOW_OVERLAP = 0.5

/** Gyro axis key. */
export type GyroAxis = 'x' | 'y' | 'z'

/** The three gyro axes, in plot order. */
export const GYRO_AXES: readonly GyroAxis[] = ['x', 'y', 'z']

/** FFT window settings (upstream `FFTWindow_per_batch` / `FFTWindow_size` inputs). */
export interface FftWindowOptions {
  /** Windows per batch for batch logs (default 1). */
  readonly windowsPerBatch?: number
  /** Window size in samples for raw logs (default 1024); must be a power of two. */
  readonly windowSize?: number
}

/** Windowed FFT of one gyro instance (upstream `run_batch_fft` result). */
export interface GyroFft {
  /** Bin frequencies (Hz). */
  readonly bins: Float64Array
  /** Centre time of every window (s). */
  readonly time: Float64Array
  readonly averageSampleRate: number
  readonly windowSize: number
  /** Hann window amplitude/energy correction factors. */
  readonly correction: WindowCorrection
  /** |FFT| per window, per axis. */
  readonly x: readonly Float64Array[]
  readonly y: readonly Float64Array[]
  readonly z: readonly Float64Array[]
}

/**
 * Window size for a set of batches. For batch logs it is chosen so `windowsPerBatch` windows
 * with 50 % overlap fit the first batch.
 */
export function fftWindowSize(batches: readonly GyroBatch[], type: GyroLogType, options: FftWindowOptions = {}): number {
  if (type === 'batch') {
    const numPoints = batches[0]?.x.length ?? 0
    // Must have at least one window
    const windowsPerBatch = Math.max(Math.trunc(options.windowsPerBatch ?? 1), 1)
    // Calculate window size for given number of windows and overlap
    return Math.floor(numPoints / (1 + (windowsPerBatch - 1) * (1 - WINDOW_OVERLAP)))
  }
  return Math.trunc(options.windowSize ?? 1024)
}

/**
 * Run the windowed FFT over every batch of one gyro instance (upstream `run_batch_fft`).
 * Throws when the window size is not a power of two.
 *
 * The average sample period is computed exactly as upstream, which (because of a hoisted
 * `window_size` and a fixed `[0]` index) is the first batch's rate summed once per batch,
 * i.e. effectively the first batch's sample rate.
 */
export function runGyroFft(batches: readonly GyroBatch[], type: GyroLogType, options: FftWindowOptions = {}): GyroFft {
  const numBatch = batches.length
  let sampleRateSum = 0
  let sampleRateCount = 0
  for (let i = 0; i < numBatch; i++) {
    sampleRateCount++
    sampleRateSum += batches[0]!.sampleRate
  }
  // Average sample time
  const sampleTime = sampleRateCount / sampleRateSum

  const windowSize = fftWindowSize(batches, type, options)
  if (!isPowerOfTwo(windowSize)) throw new Error('Window size must be a power of two')

  const windowSpacing = Math.round(windowSize * (1 - WINDOW_OVERLAP))
  const window = hanning(windowSize)
  // Get windowing correction factors for use later when plotting
  const correction = windowCorrectionFactors(window)
  const bins = rfftFreq(windowSize, sampleTime)
  const fft = new RealFft(windowSize)

  const x: Float64Array[] = []
  const y: Float64Array[] = []
  const z: Float64Array[] = []
  const time: number[] = []
  for (const batch of batches) {
    // Log section is too short, skip
    if (batch.x.length < windowSize) continue
    const ret = runFft(batch, ['x', 'y', 'z'] as const, { windowSize, windowSpacing, window, fft })
    time.push(...arrayOffset(arrayScale(ret.center, sampleTime), batch.sampleTime))
    for (let j = 0; j < ret.center.length; j++) {
      x.push(complexAbs(ret.spectra.x[j]!))
      y.push(complexAbs(ret.spectra.y[j]!))
      z.push(complexAbs(ret.spectra.z[j]!))
    }
  }

  return { bins, time: Float64Array.from(time), averageSampleRate: 1 / sampleTime, windowSize, correction, x, y, z }
}
