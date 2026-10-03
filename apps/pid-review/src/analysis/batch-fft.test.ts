import { describe, expect, it } from 'vitest'
import { fftAmplitudeScale } from '@apwt/signal'
import { computeAxisFft } from './batch-fft.js'
import type { PidBatch } from './data.js'
import { meanSpectrum } from './spectrum.js'

function sineBatch(hz: number, amp: number, rate: number, n: number, t0 = 0): PidBatch {
  const time = new Float64Array(n)
  const tar = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    time[i] = t0 + i / rate
    tar[i] = amp * Math.sin(2 * Math.PI * hz * (i / rate))
  }
  return { time, sampleRate: rate, signals: { Tar: tar, Act: tar, Out: new Float64Array(n) } }
}

describe('computeAxisFft + meanSpectrum', () => {
  it('returns null when no batch is a window long', () => {
    expect(computeAxisFft([[sineBatch(10, 1, 400, 100)]], 512)).toBeNull()
  })

  it('recovers a sinusoid amplitude at the right bin', () => {
    const rate = 400
    const batch = sineBatch(50, 3, rate, 4096)
    const fft = computeAxisFft([[batch], null], 512)!
    expect(fft.sets[1]).toBeNull()
    expect(fft.axis.averageSampleRate).toBeCloseTo(rate, 6)
    const linear = fftAmplitudeScale({})
    const spectrum = meanSpectrum(fft.sets[0]!, 'Tar', fft.axis, linear, [0, 100])!
    const peak = spectrum.indexOf(Math.max(...spectrum))
    expect(fft.axis.bins[peak]).toBeCloseTo(50, 0)
    expect(spectrum[peak]).toBeCloseTo(3, 1)
    expect(meanSpectrum(fft.sets[0]!, 'P', fft.axis, linear, [0, 100])).toBeNull()
  })
})
