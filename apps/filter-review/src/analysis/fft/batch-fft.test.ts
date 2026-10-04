// Proven upstream bug fixed (docs/bug-proofs/filter-review.md, row 4): upstream's run_batch_fft
// "average sample time" sums the first batch's rate once per batch. Compared with the original and
// with upstream patched as the port behaves (test-utils/proven-fixes.ts).
import { describe, expect, it } from 'vitest'
import type { GyroBatch } from '../gyro-data.js'
import { loadFilterReviewUpstream } from '../test-utils/upstream.js'
import { runGyroFft } from './batch-fft.js'

const ramp = (n: number): Float64Array => Float64Array.from({ length: n }, (_, i) => Math.sin(i / 3))

function batches(rates: readonly number[], length = 64): GyroBatch[] {
  return rates.map((sampleRate, i) => ({ sampleTime: 10 * i, sampleRate, x: ramp(length), y: ramp(length), z: ramp(length) }))
}

function upstreamFft(data: GyroBatch[], fixed: boolean): { rate: number; bins: number[]; time: number[] } {
  const up = loadFilterReviewUpstream({ fixed })
  up.element('FFTWindow_size').value = '64'
  up.set(
    '__data',
    data.map((b) => ({
      sample_time: b.sampleTime,
      sample_rate: b.sampleRate,
      x: Array.from(b.x),
      y: Array.from(b.y),
      z: Array.from(b.z)
    }))
  )
  return up.run(`(() => {
    Gyro_batch = []
    Gyro_batch.type = "raw"
    const r = run_batch_fft(__data)
    return { rate: r.average_sample_rate, bins: Array.from(r.bins), time: Array.from(r.time) }
  })()`) as { rate: number; bins: number[]; time: number[] }
}

describe('runGyroFft sample rate', () => {
  it('averages the rates of the batches it uses, where upstream uses the first batch rate', () => {
    const data = batches([1000, 2000])
    expect(upstreamFft(data, false).rate).toBe(1000)
    const mine = runGyroFft(data, 'raw', { windowSize: 64 })
    expect(mine.averageSampleRate).toBe(1500)
    const fixed = upstreamFft(data, true)
    expect(mine.averageSampleRate).toBe(fixed.rate)
    expect(Array.from(mine.bins)).toEqual(fixed.bins)
    expect(Array.from(mine.time)).toEqual(fixed.time)
  })

  it('is unchanged when every batch has the same rate, or when no batch is long enough', () => {
    for (const data of [batches([1000, 1000]), batches([1000, 2000], 32)]) {
      const original = upstreamFft(data, false)
      const mine = runGyroFft(data, 'raw', { windowSize: 64 })
      expect(mine.averageSampleRate).toBe(original.rate)
      expect(Array.from(mine.bins)).toEqual(original.bins)
      expect(Array.from(mine.time)).toEqual(original.time)
    }
  })
})
