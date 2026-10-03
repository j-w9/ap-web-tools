// Row: "Sample-rate mismatch check compares `filters[0].sample_rate` with itself and calls an undefined
// `error()`". Verdict: docs/bug-proofs/filter-tool.md.
import { describe, expect, it } from 'vitest'
import { freshPage, gyroFilters, thrown } from './_harness.js'

describe('evaluate_transfer_functions sample-rate check', () => {
  it('empty gyro rate with Post filtering: calculate_pid throws ReferenceError', () => {
    const page = freshPage()
    page.el('GyroSampleRate').value = ''
    page.el('PID_filtering_Post').checked = true
    expect(thrown(() => page.call('calculate_pid'))).toEqual({ name: 'ReferenceError', message: 'error is not defined' })
  })

  it('empty gyro rate with Pre filtering: the PID plots', () => {
    const page = freshPage()
    page.el('GyroSampleRate').value = ''
    page.el('PID_filtering_Pre').checked = true
    expect(thrown(() => page.call('calculate_pid'))).toBeUndefined()
    const bode = page.context.BodePID as { data: { y: number[] }[] }
    expect(bode.data[0]!.y.length).toBeGreaterThan(0)
  })

  it('a check written with the loop index (filters[j]) fires for the same inputs, and never otherwise', () => {
    const page = freshPage()
    // Every filter of a gyro group is built at the one rate get_filters is given.
    const mismatch = (rate: number) => {
      const f = gyroFilters(page, rate)
      return f.some((g, j) => j > 0 && g.sample_rate != f[0]!.sample_rate)
    }
    expect(gyroFilters(page, 2000).map((f) => f.sample_rate)).toEqual([2000, 2000, 2000])
    expect(mismatch(2000)).toBe(false)
    expect(mismatch(NaN)).toBe(true)
  })
})
