import { RealFft, arrayOffset, arrayScale, hanning, rfftFreq, runFft, windowCorrectionFactors } from '@apwt/signal'
import type { PidAxisFft, PidBatch, SetFft } from './data.js'
import { FFT_KEYS, type FftKey } from './keys.js'

/** Upstream hard-codes 50 % overlap between windows. */
const WINDOW_OVERLAP = 0.5

/**
 * Run the windowed FFT over every batch of every parameter set. Batches shorter than one
 * window are skipped. The average sample period across all usable batches defines the
 * frequency bins. Returns null when no batch is long enough.
 */
export function computeAxisFft(sets: readonly (readonly PidBatch[] | null)[], windowSize: number): PidAxisFft | null {
  const windowSpacing = Math.round(windowSize * (1 - WINDOW_OVERLAP))
  const window = hanning(windowSize)
  const correction = windowCorrectionFactors(window)
  const fft = new RealFft(windowSize)

  let rateSum = 0
  let rateCount = 0
  for (const set of sets) {
    for (const batch of set ?? []) {
      if (batch.signals.Tar.length < windowSize) continue
      rateSum += batch.sampleRate
      rateCount++
    }
  }
  if (rateSum === 0) return null
  const samplePeriod = rateCount / rateSum

  const result: (SetFft | null)[] = sets.map((set) => {
    if (!set) return null
    let out: SetFft | null = null
    for (const batch of set) {
      if (batch.signals.Tar.length < windowSize) continue
      const keys = FFT_KEYS.filter((k) => batch.signals[k] != null)
      const r = runFft(batch.signals as Record<FftKey, Float64Array>, keys, { windowSize, windowSpacing, window, fft })
      out ??= { time: new Float64Array(0), spectra: {} }
      const centreTimes = arrayOffset(arrayScale(r.center, samplePeriod), batch.time[0] as number)
      out.time = concat(out.time, centreTimes)
      for (const key of keys) {
        ;(out.spectra[key] ??= []).push(...r.spectra[key])
      }
    }
    return out
  })

  return {
    sets: result,
    axis: {
      bins: rfftFreq(windowSize, samplePeriod),
      averageSampleRate: 1 / samplePeriod,
      windowSize,
      correction
    }
  }
}

function concat(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}
