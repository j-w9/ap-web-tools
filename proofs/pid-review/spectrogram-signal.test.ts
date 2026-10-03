// PID Review `add_param_sets`: spectrogram signal switched to Output.
import { describe, expect, it } from 'vitest'
import { loadPidReview } from './_harness'

describe('add_param_sets spectrogram selection', () => {
  it('moves the spectrogram from P (enabled) to Output on a PID log without D FF', () => {
    const page = loadPidReview()
    page.run(`
      const sets = [[{ DFF: null }]]
      sets[0].FFT = {}
      PID_log_messages = [{ id: ['PIDR'], params: { prefix: 'ATC_RAT_RLL_', sets: [{ start_time: 0, end_time: 1e9 }] }, sets }]
      get_axis_index = () => 0
    `)
    page.element('Spec_P').checked = true
    page.run('add_param_sets()')
    expect(page.element('Spec_P').disabled).toBe(false)
    expect(page.element('Spec_DFF').disabled).toBe(true)
    expect(page.element('Spec_P').checked).toBe(false)
    expect(page.element('Spec_Out').checked).toBe(true)
  })

  it('keeps P selected when the log has D FF', () => {
    const page = loadPidReview()
    page.run(`
      const sets = [[{ DFF: [0] }]]
      sets[0].FFT = {}
      PID_log_messages = [{ id: ['PIDR'], params: { prefix: 'ATC_RAT_RLL_', sets: [{ start_time: 0, end_time: 1e9 }] }, sets }]
      get_axis_index = () => 0
    `)
    page.element('Spec_P').checked = true
    page.run('add_param_sets()')
    expect(page.element('Spec_P').checked).toBe(true)
    expect(page.element('Spec_Out').checked).toBe(false)
  })
})
