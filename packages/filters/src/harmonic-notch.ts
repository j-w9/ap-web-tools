/**
 * Harmonic notch as FilterTool and AnalyticTune model it (upstream `HarmonicNotchFilter` in
 * `FilterTool/filters.js` and `AnalyticTune.js`): a fixed operating point instead of logged
 * tracking data, every notch evaluated on its own. FilterReview's log-driven model is in
 * `tracked-notch.ts`.
 */
import { complexMul, type ComplexArray } from '@apwt/signal'
import { designNotchWithBandwidth, notchResponse, type BandwidthNotch } from './notch.js'
import { unityResponse, type ZGrid } from './z-grid.js'

/** Harmonic numbers selectable in `_HMNCS` (bit n selects harmonic n + 1); upstream models the first eight. */
export const HARMONICS = [1, 2, 3, 4, 5, 6, 7, 8] as const
export type Harmonic = (typeof HARMONICS)[number]

/** Notches per harmonic, from the `_OPTS` double (bit 0) and triple (bit 4) options. */
export type NotchComposition = 'single' | 'double' | 'triple'

export const COMPOSITE_NOTCHES: Readonly<Record<NotchComposition, number>> = { single: 1, double: 2, triple: 3 }

/** How the notch centre follows the vehicle (`_MODE`), with the parameters each mode uses. */
export type NotchTracking =
  | { readonly mode: 'fixed' }
  /** Scales with the square root of throttle relative to `_REF`, never below `_FM_RAT` x `_FREQ`. */
  | { readonly mode: 'throttle'; readonly reference: number; readonly minRatio: number }
  /** Follows an RPM sensor (`RPM1` or `RPM2`) scaled by `_REF`, never below `_FREQ`. */
  | { readonly mode: 'rpm'; readonly sensor: 1 | 2; readonly reference: number }
  /** Follows ESC telemetry; with multi-source, one notch set per motor. */
  | { readonly mode: 'esc'; readonly reference: number; readonly multiSource: boolean }
  /** In-flight FFT (FilterTool only); with no log to analyse the centre stays at `_FREQ`, as upstream. */
  | { readonly mode: 'fft' }

export type TrackingMode = NotchTracking['mode']

/** A harmonic notch's configuration (one `INS_HNTCH_*` / `INS_HNTC2_*` group). */
export interface HarmonicNotchConfig {
  readonly enabled: boolean
  readonly tracking: NotchTracking
  readonly baseFreqHz: number
  readonly bandwidthHz: number
  readonly attenuationDb: number
  readonly harmonics: readonly Harmonic[]
  readonly composition: NotchComposition
}

/** Values of the tracking sources, which these tools take as inputs instead of from a log. */
export interface OperatingPoint {
  /** Throttle, 0 to 1. */
  readonly throttle: number
  readonly rpm1: number
  readonly rpm2: number
  readonly escRpm: number
  /** Motors sending ESC telemetry; used by multi-source ESC tracking. */
  readonly numMotors: number
}

/** A designed harmonic notch: the tracked fundamental and every resulting notch. */
export interface HarmonicNotch {
  readonly kind: 'harmonic-notch'
  readonly sampleRate: number
  readonly enabled: boolean
  /** Fundamental centre frequency after tracking (Hz). */
  readonly fundamentalHz: number
  readonly notches: readonly BandwidthNotch[]
}

/** The fundamental after applying the tracking mode at the operating point. */
export function trackedFrequency(config: HarmonicNotchConfig, op: OperatingPoint): number {
  const freq = config.baseFreqHz
  const t = config.tracking
  switch (t.mode) {
    case 'fixed':
    case 'fft':
      return freq
    case 'throttle': {
      const motorsThrottle = Math.max(0, op.throttle)
      return freq * Math.max(t.minRatio, Math.sqrt(motorsThrottle / t.reference))
    }
    case 'rpm':
      return Math.max((t.sensor === 1 ? op.rpm1 : op.rpm2) / 60.0, freq) * t.reference
    case 'esc':
      return Math.max(op.escRpm / 60.0, freq) * t.reference
  }
}

/** Build the notches of a harmonic notch filter (upstream `HarmonicNotchFilter`). */
export function designHarmonicNotch(sampleRate: number, config: HarmonicNotchConfig, op: OperatingPoint): HarmonicNotch {
  const freq = trackedFrequency(config, op)
  const base = { kind: 'harmonic-notch', sampleRate, fundamentalHz: freq } as const
  if (!config.enabled) return { ...base, enabled: false, notches: [] }

  const chained = config.tracking.mode === 'esc' && config.tracking.multiSource ? op.numMotors : 1
  const compositeNotches = COMPOSITE_NOTCHES[config.composition]
  const notches: BandwidthNotch[] = []
  const att = config.attenuationDb

  for (const fmul of config.harmonics) {
    let notchCenter = freq * fmul
    const bandwidthHz = config.bandwidthHz * fmul
    const notchBandwidth = bandwidthHz / compositeNotches
    // Spread required to achieve an equivalent single notch using two notches with bandwidth/2, from
    // the unclamped centre. Upstream computes it inside the copy loop, after the first copy has
    // clamped the centre, so chained copies of a clamped harmonic differ from the first; that is a
    // proven upstream bug, fixed here (docs/bug-proofs/filters.md, row 2): every copy uses the first
    // copy's spread, as ArduPilot uses one spread for every centre.
    const notchSpread = bandwidthHz / (32.0 * notchCenter)
    for (let c = 0; c < chained; c++) {
      const nyquistLimit = sampleRate * 0.48
      const bandwidthLimit = bandwidthHz * 0.52

      // adjust the fundamental center frequency to be in the allowable range
      notchCenter = Math.min(Math.max(notchCenter, bandwidthLimit), nyquistLimit)

      // only enable a notch if its center frequency is below the nyquist frequency
      if (compositeNotches !== 2 && notchCenter < nyquistLimit) {
        notches.push(designNotchWithBandwidth(sampleRate, notchCenter, notchBandwidth, att))
      }
      if (compositeNotches > 1) {
        for (const spread of [1.0 - notchSpread, 1.0 + notchSpread]) {
          const center = notchCenter * spread
          if (center < nyquistLimit) notches.push(designNotchWithBandwidth(sampleRate, center, notchBandwidth, att))
        }
      }
    }
  }
  return { ...base, enabled: true, notches }
}

/** Product of every notch's response, starting from unity, in design order. */
export function harmonicNotchResponse(filter: HarmonicNotch, grid: ZGrid): ComplexArray {
  let h = unityResponse(grid.z1.re.length)
  for (const notch of filter.notches) h = complexMul(h, notchResponse(notch, grid))
  return h
}
