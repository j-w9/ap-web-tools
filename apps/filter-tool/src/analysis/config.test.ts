import { describe, expect, it } from 'vitest'
import { compositionFromOptions, harmonicsFromMask, trackingFromParams } from './config.js'

describe('parameter interpretation', () => {
  it('reads harmonics from the bitmask', () => {
    expect(harmonicsFromMask(0)).toEqual([])
    expect(harmonicsFromMask(0b10000101)).toEqual([1, 3, 8])
  })

  it('prefers double over triple notches', () => {
    expect(compositionFromOptions(0)).toBe('single')
    expect(compositionFromOptions(17)).toBe('double')
    expect(compositionFromOptions(16)).toBe('triple')
  })

  it('maps modes to tracking, unknown values to fixed', () => {
    expect(trackingFromParams(3, 1, 1, 2)).toEqual({ mode: 'esc', reference: 1, multiSource: true })
    expect(trackingFromParams(5, 0.5, 1, 0)).toEqual({ mode: 'rpm', sensor: 2, reference: 0.5 })
    expect(trackingFromParams(1.5, 1, 1, 0)).toEqual({ mode: 'fixed' })
  })
})
