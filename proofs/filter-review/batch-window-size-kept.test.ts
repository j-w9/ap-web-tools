import { describe, expect, it } from 'vitest'
import { loadPage, ramp } from './_harness.js'

// Row: "Batch window size written into the raw window-size input".
describe('FilterReview calculate() on a batch log, then reset() for the next log', () => {
  it('leaves the batch-derived window size (512) in the raw window-size input', () => {
    const page = loadPage()
    expect(page.element('FFTWindow_size').value).toBe('1024')
    page.element('FFTWindow_per_batch').value = '3'
    page.set('__x', ramp(1024, 0, 0))
    page.run(`(() => {
      tracking_methods = []
      Gyro_batch = [[{ sample_time: 0, sample_rate: 1000, x: __x, y: __x, z: __x }]]
      Gyro_batch.type = "batch"
      Gyro_batch[0].sensor_num = 0
      Gyro_batch[0].post_filter = false
      Gyro_batch.have_post = false
      calculate()
    })()`)
    expect(page.element('FFTWindow_size').value).toBe('512')
    page.run('reset()')
    expect(page.element('FFTWindow_size').value).toBe('512')
  })
})
