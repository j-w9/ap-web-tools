import { describe, expect, it } from 'vitest'
import { loadPage, ramp } from './_harness.js'

// Row: "FFT sample rate is the first batch's rate".
describe('FilterReview run_batch_fft: two raw batches at 1000 Hz and 2000 Hz', () => {
  it('reports the first batch rate as the average and uses it for the bins and window times', () => {
    const page = loadPage()
    page.element('FFTWindow_size').value = '64'
    const batch = (rate: number, t0: number): Record<string, unknown> => ({
      sample_time: t0,
      sample_rate: rate,
      x: ramp(64, 0, 0),
      y: ramp(64, 0, 0),
      z: ramp(64, 0, 0)
    })
    page.set('__data', [batch(1000, 0), batch(2000, 10)])
    const out = page.run(`(() => {
      Gyro_batch = []
      Gyro_batch.type = "raw"
      const r = run_batch_fft(__data)
      return { rate: r.average_sample_rate, top_bin: r.bins[r.bins.length - 1], time: r.time }
    })()`) as { rate: number; top_bin: number; time: number[] }
    expect(out.rate).toBe(1000)
    expect(out.top_bin).toBe(500)
    // One window per batch, centre at sample 32, scaled by the first batch's 1/1000 s.
    expect(out.time).toEqual([0.032, 10.032])
  })
})
