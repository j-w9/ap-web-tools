import { describe, expect, it } from 'vitest'
import {
  designHarmonicNotch,
  designLowPass,
  designNotch,
  trackedFrequency,
  type HarmonicNotchConfig,
  type OperatingPoint
} from './filters.js'
import { compositionFromOptions, harmonicsFromMask, trackingFromParams } from './config.js'

const OP: OperatingPoint = { throttle: 0.25, rpm1: 3000, rpm2: 1200, escRpm: 4800, numMotors: 4 }

const config = (overrides: Partial<HarmonicNotchConfig>): HarmonicNotchConfig => ({
  enabled: true,
  tracking: { mode: 'fixed' },
  baseFreqHz: 80,
  bandwidthHz: 40,
  attenuationDb: 40,
  harmonics: [1],
  composition: 'single',
  ...overrides
})

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

describe('notch tracking', () => {
  it('scales throttle notches with sqrt(throttle / ref), limited by FM_RAT', () => {
    expect(trackedFrequency(config({ tracking: { mode: 'throttle', reference: 0.25, minRatio: 0.5 } }), OP)).toBeCloseTo(80)
    expect(trackedFrequency(config({ tracking: { mode: 'throttle', reference: 1, minRatio: 0.7 } }), OP)).toBeCloseTo(56)
  })

  it('follows RPM and ESC telemetry above the base frequency', () => {
    expect(trackedFrequency(config({ tracking: { mode: 'rpm', sensor: 1, reference: 1 } }), OP)).toBe(80)
    expect(trackedFrequency(config({ tracking: { mode: 'esc', reference: 1, multiSource: false } }), OP)).toBe(80)
    expect(trackedFrequency(config({ baseFreqHz: 10, tracking: { mode: 'rpm', sensor: 2, reference: 2 } }), OP)).toBe(40)
  })
})

describe('designHarmonicNotch', () => {
  it('builds one notch per harmonic and per composite notch', () => {
    expect(designHarmonicNotch(2000, config({ harmonics: [1, 2] }), OP).notches).toHaveLength(2)
    expect(designHarmonicNotch(2000, config({ composition: 'double' }), OP).notches).toHaveLength(2)
    expect(designHarmonicNotch(2000, config({ composition: 'triple' }), OP).notches).toHaveLength(3)
  })

  it('chains a notch set per motor with multi-source ESC tracking', () => {
    const esc = config({ tracking: { mode: 'esc', reference: 1, multiSource: true } })
    expect(designHarmonicNotch(2000, esc, OP).notches).toHaveLength(4)
  })

  it('drops harmonics at or above 48 % of the sample rate', () => {
    expect(designHarmonicNotch(400, config({ harmonics: [1, 2, 3] }), OP).notches.map((n) => n.centerHz)).toEqual([80, 160])
  })

  it('has no notches when disabled', () => {
    const f = designHarmonicNotch(2000, config({ enabled: false }), OP)
    expect(f.enabled).toBe(false)
    expect(f.notches).toEqual([])
  })
})

describe('designNotch and designLowPass', () => {
  it('passes everything outside the allowed centre range', () => {
    expect(designNotch(1000, 600, 40, 40).biquad).toBeNull()
    expect(designNotch(1000, 15, 40, 40).biquad).toBeNull()
    expect(designNotch(1000, 100, 40, 40).biquad).not.toBeNull()
  })

  it('disables the low-pass at zero cut-off', () => {
    expect(designLowPass(1000, 0).biquad).toBeNull()
    const b = designLowPass(1000, 100).biquad!
    // Unity gain at DC.
    expect((b.b0 + b.b1 + b.b2) / (b.a0 + b.a1 + b.a2)).toBeCloseTo(1, 12)
  })
})
