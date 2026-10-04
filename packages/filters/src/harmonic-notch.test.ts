import { arrayLog10, arrayScale, complexAbs } from '@apwt/signal'
import { describe, expect, it } from 'vitest'
import {
  HARMONICS,
  chainResponse,
  designBiquadLowPass,
  designHarmonicNotch,
  designNotchWithBandwidth,
  frequencyGrid,
  phaseDegrees,
  trackedFrequency,
  unwrapPhase,
  type HarmonicNotchConfig,
  type OperatingPoint
} from './index.js'
import { expectBitEqual, expectComplexBitEqual } from './test-utils/compare.js'
import { rng } from './test-utils/random.js'
import { loadUpstream, type Pair, type UpstreamScript, type UpstreamTool } from './test-utils/upstream.js'

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

/**
 * Oracle: upstream `HarmonicNotchFilter` (FilterTool and AnalyticTune share it) reads the operating
 * point through `get_form`, so the vm context gets a stub `document` holding those inputs. The
 * parameter decoding below is what upstream does inline (`enable <= 0`, `mode ==`, `opts & 1/2/16`,
 * `hmncs & (1 << n)`); the apps implement the same decoding in their own config modules.
 */
describe('designHarmonicNotch matches upstream HarmonicNotchFilter', () => {
  interface RawNotch {
    enable: number
    mode: number
    freq: number
    bw: number
    att: number
    ref: number
    fmRat: number
    hmncs: number
    opts: number
  }

  function decode(p: RawNotch): HarmonicNotchConfig {
    const bit = (v: number, b: number): boolean => (v & (1 << b)) !== 0
    const tracking = ((): HarmonicNotchConfig['tracking'] => {
      switch (p.mode) {
        case 1:
          return { mode: 'throttle', reference: p.ref, minRatio: p.fmRat }
        case 2:
          return { mode: 'rpm', sensor: 1, reference: p.ref }
        case 3:
          return { mode: 'esc', reference: p.ref, multiSource: bit(p.opts, 1) }
        case 4:
          return { mode: 'fft' }
        case 5:
          return { mode: 'rpm', sensor: 2, reference: p.ref }
        default:
          return { mode: 'fixed' }
      }
    })()
    return {
      enabled: !(p.enable <= 0),
      tracking,
      baseFreqHz: p.freq,
      bandwidthHz: p.bw,
      attenuationDb: p.att,
      harmonics: HARMONICS.filter((h) => bit(p.hmncs, h - 1)),
      composition: bit(p.opts, 0) ? 'double' : bit(p.opts, 4) ? 'triple' : 'single'
    }
  }

  const next = rng(77)
  const pick = (lo: number, hi: number): number => lo + (hi - lo) * next()
  const cases: { rate: number; op: OperatingPoint; p: RawNotch }[] = []
  for (let n = 0; n < 40; n++) {
    cases.push({
      rate: [400, 1000, 2000, 8000, 1333.3][n % 5]!,
      op: {
        throttle: n % 7 === 0 ? -0.1 : pick(0, 1),
        rpm1: pick(0, 9000),
        rpm2: pick(0, 9000),
        escRpm: pick(0, 12000),
        // Fractional and NaN motor counts: upstream loops `c < chained`.
        numMotors: n % 9 === 0 ? NaN : n % 4 === 0 ? 2.5 : Math.floor(pick(1, 8))
      },
      p: {
        enable: [1, 0, -1, NaN, 2][n % 5]!,
        mode: [0, 1, 2, 3, 4, 5, 6, 1.5][n % 8]!,
        freq: n % 11 === 0 ? 0 : pick(5, 300),
        bw: pick(1, 150),
        att: pick(5, 60),
        ref: n % 13 === 0 ? 0 : pick(0.05, 1.2),
        fmRat: pick(0, 1),
        hmncs: n % 10 === 0 ? 0 : Math.floor(pick(1, 512)),
        opts: Math.floor(pick(0, 64))
      }
    })
  }

  function construct(tool: UpstreamTool, c: (typeof cases)[number], fixChainedSpread = true): UpstreamScript {
    const up = loadUpstream(tool, { fixChainedSpread })
    const form: Record<string, number> = {
      Throttle: c.op.throttle,
      RPM1: c.op.rpm1,
      RPM2: c.op.rpm2,
      ESC_RPM: c.op.escRpm,
      NUM_MOTORS: c.op.numMotors
    }
    up.set('document', { getElementById: (id: string) => ({ value: String(form[id]) }) })
    up.set('setCookie', () => undefined)
    const p = c.p
    up.run(
      `var __f = new HarmonicNotchFilter(${c.rate}, ${p.enable}, ${p.mode}, ${p.freq}, ${p.bw}, ${p.att}, ${p.ref}, ${p.fmRat}, ${p.hmncs}, ${p.opts})`
    )
    return up
  }

  /**
   * The proven chained-spread case (docs/bug-proofs/filters.md, row 2): ESC tracking with multi-source
   * chaining, a double or triple notch, more than one copy, and an enabled harmonic whose centre is
   * clamped to [0.52 bw, 0.48 fs]. Only there may the original differ from the port.
   */
  function chainedSpreadCase(c: (typeof cases)[number]): boolean {
    const { p, op, rate } = c
    if (p.enable <= 0 || p.mode !== 3 || (p.opts & 2) === 0 || (p.opts & 17) === 0 || !(op.numMotors > 1)) return false
    const freq = Math.max(op.escRpm / 60, p.freq) * p.ref
    return HARMONICS.some(
      (h) => (p.hmncs & (1 << (h - 1))) !== 0 && Math.min(Math.max(freq * h, p.bw * h * 0.52), rate * 0.48) !== freq * h
    )
  }

  const centres = (up: UpstreamScript) => up.run('__f.notches.map((n) => n.center_freq_hz)') as number[]

  // Every case is compared with upstream with the proven bug fixed (`fixChainedSpread`); this checks
  // that the fix changes nothing outside the proven case, and that the original's result is kept
  // there as evidence.
  it('differs from the original only in the proven chained-spread case', () => {
    let affected = 0
    for (const c of cases) {
      for (const tool of ['AnalyticTune', 'FilterTool'] as const) {
        const original = centres(construct(tool, c, false))
        const fixed = centres(construct(tool, c))
        const mine = designHarmonicNotch(c.rate, decode(c.p), c.op).notches.map((n) => n.centerHz)
        if (JSON.stringify(original) === JSON.stringify(fixed)) continue
        affected++
        expect(chainedSpreadCase(c)).toBe(true)
        expect(mine).not.toEqual(original)
      }
    }
    expect(affected).toBeGreaterThan(0)
  })

  it('proven upstream bug fixed: chained copies of a clamped harmonic equal the first copy', () => {
    // The reproduction of proofs/filters/filters.test.ts: ESC mode, double notch + multi-source, two
    // motors at ESC_RPM 0, FREQ 10, BW 40 at 2 kHz. The original gives [18.2, 23.4, 19.55, 22.05].
    const c = {
      rate: 2000,
      op: { throttle: 0, rpm1: 0, rpm2: 0, escRpm: 0, numMotors: 2 },
      p: { enable: 1, mode: 3, freq: 10, bw: 40, att: 40, ref: 1, fmRat: 1, hmncs: 1, opts: 3 }
    }
    expect(centres(construct('FilterTool', c, false))).toEqual([18.2, 23.400000000000002, 19.55, 22.049999999999997])
    const mine = designHarmonicNotch(c.rate, decode(c.p), c.op).notches.map((n) => n.centerHz)
    expect(mine).toEqual([18.2, 23.400000000000002, 18.2, 23.400000000000002])
    expect(centres(construct('FilterTool', c))).toEqual(mine)
  })

  it.each(cases.map((c, i) => [i, c] as const))('case %i (AnalyticTune H, FilterTool magnitude and phase)', (_, c) => {
    const mine = designHarmonicNotch(c.rate, decode(c.p), c.op)
    const freq = frequencyGrid(c.rate * 0.5, c.rate / 512)

    const at = construct('AnalyticTune', c)
    expect(mine.enabled).toBe(at.run('__f.enabled'))
    expect(mine.notches.length).toBe(mine.enabled ? at.run('__f.notches.length') : 0)
    const expected = at.run(`evaluate_transfer_functions([[__f]], ${c.rate * 0.5}, ${c.rate / 512}, false, false)`) as {
      H_total: Pair
    }
    expectComplexBitEqual(chainResponse(freq, [[mine]]), expected.H_total, 'H')

    const ft = construct('FilterTool', c)
    const bode = ft.run(`evaluate_transfer_functions([[__f]], ${c.rate * 0.5}, 0.1, true, true)`) as {
      attenuation: number[]
      phase: number[]
    }
    const h = chainResponse(frequencyGrid(c.rate * 0.5, 0.1), [[mine]])
    expectBitEqual(arrayScale(arrayLog10(complexAbs(h)), 20), bode.attenuation, 'dB')
    expectBitEqual(unwrapPhase(phaseDegrees(h)), bode.phase, 'unwrapped phase')
  })
})
