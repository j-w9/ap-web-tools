import { describe, expect, it } from 'vitest'
import { loadPage } from './_harness.js'

// Row: "Empty, zero or negative loop rate crashes the redraw with aliasing on".
describe('FilterReview get_alias_obj with aliasing shown', () => {
  it.each(['', '0', '-400'])('SCHED_LOOP_RATE %j throws "Invalid array length"', (rate) => {
    const page = loadPage()
    page.element('Aliasing_on').checked = true
    page.element('SCHED_LOOP_RATE').value = rate
    expect(page.element('SCHED_LOOP_RATE').value).toBe(rate)
    const fft = '{ x: [[1, 1, 1]], bins: [0, 250, 500], average_sample_rate: 1000, window_size: 4 }'
    expect(() => page.run(`get_alias_obj(${fft})`)).toThrow('Invalid array length')
  })

  it('SCHED_LOOP_RATE 400 works', () => {
    const page = loadPage()
    page.element('Aliasing_on').checked = true
    page.element('SCHED_LOOP_RATE').value = '400'
    const fft = '{ x: [[1, 1, 1]], bins: [0, 250, 500], average_sample_rate: 1000, window_size: 4 }'
    expect(page.run(`get_alias_obj(${fft}).len`)).toBe(9)
  })
})
