import { describe, expect, it } from 'vitest'
import {
  designBiquadLowPass,
  designHarmonicNotch,
  designNotchWithBandwidth,
  trackedFrequency,
  type HarmonicNotchConfig,
  type OperatingPoint
} from './index.js'

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

  it('keeps FFT tracking at the base frequency without a log', () => {
    expect(trackedFrequency(config({ tracking: { mode: 'fft' } }), OP)).toBe(80)
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

  it('has no notches when disabled, but still reports the tracked fundamental', () => {
    const f = designHarmonicNotch(2000, config({ enabled: false }), OP)
    expect(f.enabled).toBe(false)
    expect(f.notches).toEqual([])
    expect(f.fundamentalHz).toBe(80)
  })
})

describe('designNotchWithBandwidth and designBiquadLowPass', () => {
  it('passes everything outside the allowed centre range', () => {
    expect(designNotchWithBandwidth(1000, 600, 40, 40).biquad).toBeNull()
    expect(designNotchWithBandwidth(1000, 15, 40, 40).biquad).toBeNull()
    expect(designNotchWithBandwidth(1000, 100, 40, 40).biquad).not.toBeNull()
  })

  it('disables the low-pass at zero cut-off', () => {
    expect(designBiquadLowPass(1000, 0).biquad).toBeNull()
    const b = designBiquadLowPass(1000, 100).biquad!
    // Unity gain at DC.
    expect((b.b0 + b.b1 + b.b2) / (b.a0 + b.a1 + b.a2)).toBeCloseTo(1, 12)
  })
})
