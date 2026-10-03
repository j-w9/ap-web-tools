import { describe, expect, it } from 'vitest'
import { loadPage } from './_harness.js'

// Row: "Single-window range shifts the wrapped phase band twice".
describe('FilterReview phase_scale with one window averaged', () => {
  it('shifts the shared max/min array once per reference, ending 360 deg off the mean', () => {
    const page = loadPage()
    page.element('ScaleWrap').checked = true
    // redraw_post_estimate_and_bode with start_index + 1 == end_index: Phase_max and Phase_min are
    // both the window's HR_phase array, and Phase_mean is a new array with the same values.
    const out = page.run(`(() => {
      const HR_phase = [0, 200]
      const Phase_mean = array_scale(array_add([0, 0], HR_phase), 1)
      const Phase_max = HR_phase
      const Phase_min = HR_phase
      const scaled = phase_scale([Phase_mean, Phase_max, Phase_min])
      return { mean: Array.from(scaled[0]), max: Array.from(scaled[1]), min: Array.from(scaled[2]) }
    })()`)
    expect(out).toEqual({ mean: [0, -160], max: [0, -520], min: [0, -520] })
  })

  it('with two different arrays per reference (two windows), the band moves with the mean', () => {
    const page = loadPage()
    page.element('ScaleWrap').checked = true
    const out = page.run(`(() => {
      const scaled = phase_scale([[0, 200], [0, 210], [0, 190]])
      return scaled.map((a) => Array.from(a))
    })()`)
    expect(out).toEqual([
      [0, -160],
      [0, -150],
      [0, -170]
    ])
  })
})
