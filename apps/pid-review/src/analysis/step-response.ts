import {
  RealFft,
  arrayAdd,
  arrayInverse,
  arrayOffset,
  arrayScale,
  complexConj,
  complexDiv,
  complexMul,
  hanning,
  realLength,
  runFft,
  toDoubleSided,
  toInterleaved
} from '@apwt/signal'
import type { AxisFft, PidBatch } from './data.js'
import { timeRangeIndices } from './time-range.js'

export interface SetStepResponse {
  /** Seconds from the step, shared by every response. */
  time: Float64Array
  /** Every window's estimated step response. */
  all: Float64Array[]
  /** Mean of `all`. */
  mean: Float64Array
}

/** Windows whose peak target rate is below this (deg/s) carry too little excitation. */
const MIN_TARGET_AMPLITUDE = 20
/** Only the first part of the step is shown. */
const STEP_DURATION_S = 0.5
/** Gaussian noise-estimate cutoff. */
const NOISE_CUTOFF_HZ = 25

/**
 * Estimate the closed-loop step response of each parameter set by Wiener deconvolution
 * of actual against target, as in PID-Analyzer / PIDtoolbox. Returns one entry per set,
 * null where the set has no suitably excited windows.
 */
export function stepResponses(
  sets: readonly (readonly PidBatch[] | null)[],
  axis: AxisFft,
  range: readonly [number, number]
): (SetStepResponse | null)[] {
  const windowSize = axis.windowSize
  const realLen = realLength(windowSize)
  const fft = new RealFft(windowSize)
  const transfer = fft.createComplexArray()
  const impulse = fft.createComplexArray()
  const window = hanning(windowSize)
  // Large overlap to maximise data; amplitude is not used so this is fine.
  const windowSpacing = Math.round(windowSize / 16)

  const samplePeriod = 1 / axis.averageSampleRate
  const stepLen = Math.min(Math.ceil(STEP_DURATION_S / samplePeriod), windowSize)
  const time = new Float64Array(stepLen)
  for (let j = 0; j < stepLen; j++) time[j] = j * samplePeriod

  const noise = noiseEstimate(axis.bins, realLen)

  return sets.map((set) => {
    if (!set) return null
    let mean: Float64Array = new Float64Array(stepLen)
    const all: Float64Array[] = []

    for (const batch of set) {
      if (batch.signals.Tar.length < windowSize) continue
      const r = runFft({ Tar: batch.signals.Tar, Act: batch.signals.Act }, ['Tar', 'Act'], {
        windowSize,
        windowSpacing,
        window,
        fft,
        takeMax: true
      })
      const fftTime = arrayOffset(arrayScale(r.center, samplePeriod), batch.time[0] as number)
      const [start, end] = timeRangeIndices(fftTime, range[0], range[1])

      for (let k = start; k < end; k++) {
        if ((r.max!.Tar[k] as number) < MIN_TARGET_AMPLITUDE) continue
        const X = toDoubleSided(r.spectra.Tar[k]!)
        const Y = toDoubleSided(r.spectra.Act[k]!)
        const Xcon = complexConj(X)
        const Pyx = complexMul(Y, Xcon)
        const Pxx = complexMul(X, Xcon)
        const H = complexDiv(Pyx, { re: arrayAdd(Pxx.re, noise), im: Pxx.im })
        toInterleaved(transfer, H)
        fft.inverseTransform(impulse, transfer)

        const step = new Float64Array(stepLen)
        step[0] = impulse[0] as number
        for (let l = 1; l < stepLen; l++) step[l] = (step[l - 1] as number) + (impulse[l * 2] as number)
        all.push(step)
        mean = arrayAdd(mean, step)
      }
    }
    if (all.length === 0) return null
    return { time, all, mean: arrayScale(mean, 1 / all.length) }
  })
}

/**
 * Regularisation term added to the input power spectrum: the integral of a Gaussian sized
 * for a 25 Hz cutoff, reflected to a double-sided spectrum, inverted and scaled.
 */
function noiseEstimate(bins: Float64Array, realLen: number): Float64Array {
  let lenLpf = bins.findIndex((x) => x > NOISE_CUTOFF_HZ)
  lenLpf += lenLpf - 2 // double sided; DC and Nyquist are not copied
  const radius = Math.ceil(lenLpf * 0.5)
  const sigma = lenLpf / 6

  const sn = new Float64Array(realLen).fill(1)
  let last = 0
  for (let j = 0; j < lenLpf; j++) {
    last += Math.exp((-0.5 / sigma ** 2) * (j - radius) ** 2)
    sn[j] = last
  }
  for (let j = 0; j < lenLpf; j++) sn[j] = (sn[j] as number) / last

  const full = new Float64Array(realLen + (realLen - 2))
  full.set(sn)
  for (let j = 0; j < realLen - 2; j++) full[realLen + j] = sn[realLen - 2 - j] as number

  return arrayInverse(arrayScale(arrayOffset(arrayScale(full, -1), 1 + 1e-9), 10))
}
