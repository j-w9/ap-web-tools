import { describe, expect, it } from 'vitest'
import { DEFAULT_STATE, stateFromQuery, stateToQuery, type ToolState } from './settings.js'

describe('share query', () => {
  it('round-trips the whole state', () => {
    const state: ToolState = {
      inputs: { ...DEFAULT_STATE.inputs, INS_HNTCH_ENABLE: 1, INS_HNTCH_FREQ: 82.5, Throttle: 0.42 },
      gyro: { magnitude: 'linear', phase: 'wrapped', frequencyAxis: 'linear', frequencyUnit: 'RPM', showComponents: true },
      pid: { ...DEFAULT_STATE.pid, filtering: 'post', axis: 'YAW', magnitude: 'linear' }
    }
    expect(stateFromQuery(stateToQuery(state))).toEqual(state)
  })

  it('reads upstream links case-insensitively and ignores junk', () => {
    const state = stateFromQuery('?ins_hntch_freq=90&scale=linear&phasescale=wrap&filtering=post&gyrosamplerate=x&foo=1')
    expect(state.inputs.INS_HNTCH_FREQ).toBe(90)
    expect(state.inputs.GyroSampleRate).toBe(DEFAULT_STATE.inputs.GyroSampleRate)
    expect(state.gyro.magnitude).toBe('linear')
    expect(state.gyro.phase).toBe('wrapped')
    expect(state.pid.filtering).toBe('post')
    expect(state.pid.magnitude).toBe('dB')
  })

  it('uses upstream field names and values', () => {
    const query = new URLSearchParams(stateToQuery(DEFAULT_STATE))
    expect(query.get('Scale')).toBe('Log')
    expect(query.get('PID_PhaseScale')).toBe('unwrap')
    expect(query.get('feq_scale')).toBe('Log')
    expect(query.get('filtering')).toBe('Pre')
    expect(query.get('ATC_RAT_RLL_FLTD')).toBe('20')
  })
})
