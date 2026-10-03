import { describe, expect, it } from 'vitest'
import { parseParamFile } from '../analysis/param-file.js'
import { constrainSpinMin, defaultInputText, parseInputs, withParamFile } from './inputs.js'

describe('inputs', () => {
  it('starts at the upstream defaults', () => {
    expect(parseInputs(defaultInputText())).toEqual({
      MOT_SPIN_ARM: 0.1,
      MOT_SPIN_MIN: 0.15,
      MOT_SPIN_MAX: 0.95,
      MOT_PWM_MIN: 1000,
      MOT_PWM_MAX: 2000,
      MOT_THST_EXPO: 0.65,
      MOTOR_COUNT: 4,
      COPTER_AUW: 0
    })
  })

  it('reads an empty input as NaN', () => {
    expect(parseInputs({ ...defaultInputText(), MOT_PWM_MIN: '' }).MOT_PWM_MIN).toBeNaN()
  })

  it('keeps MOT_SPIN_MIN at or above MOT_SPIN_ARM', () => {
    const text = { ...defaultInputText(), MOT_SPIN_ARM: '0.2' }
    expect(constrainSpinMin(text).MOT_SPIN_MIN).toBe('0.2')
    expect(constrainSpinMin(defaultInputText()).MOT_SPIN_MIN).toBe('0.15')
  })

  it('applies a parameter file', () => {
    const next = withParamFile(defaultInputText(), parseParamFile('MOT_PWM_MIN,1100\nMOT_PWM_MAX,x'))
    expect(next.MOT_PWM_MIN).toBe('1100')
    expect(next.MOT_PWM_MAX).toBe('')
    expect(next.MOT_SPIN_ARM).toBe('0.1')
  })
})
