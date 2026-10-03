/**
 * Turn raw parameter values into typed filter configurations, following how upstream
 * `filters.js` interprets each parameter.
 */
import {
  HARMONICS,
  type HarmonicNotchConfig,
  type Harmonic,
  type NotchComposition,
  type NotchTracking,
  type OperatingPoint,
  type PidGains
} from '@apwt/filters'
import { NOTCH_PREFIXES, notchParam, pidParam, type Inputs, type NotchPrefix, type PidAxis } from './params.js'

/** `_OPTS` bits the filter maths uses. */
export const NOTCH_OPTION_BITS = { double: 0, multiSource: 1, triple: 4 } as const

/** True when `bit` is set in a parameter value, with JavaScript's 32-bit integer semantics as upstream. */
export function hasBit(value: number, bit: number): boolean {
  return (value & (1 << bit)) !== 0
}

/** Harmonics selected by an `_HMNCS` bitmask, lowest first. */
export function harmonicsFromMask(mask: number): Harmonic[] {
  return HARMONICS.filter((h) => hasBit(mask, h - 1))
}

/** Double takes precedence over triple when both are set, as in ArduPilot. */
export function compositionFromOptions(options: number): NotchComposition {
  if (hasBit(options, NOTCH_OPTION_BITS.double)) return 'double'
  if (hasBit(options, NOTCH_OPTION_BITS.triple)) return 'triple'
  return 'single'
}

/**
 * Tracking for a `_MODE` value. Upstream compares with `==`, so a mode that is not one of the
 * known integers behaves as a fixed notch.
 */
export function trackingFromParams(mode: number, reference: number, minRatio: number, options: number): NotchTracking {
  switch (mode) {
    case 1:
      return { mode: 'throttle', reference, minRatio }
    case 2:
      return { mode: 'rpm', sensor: 1, reference }
    case 3:
      return { mode: 'esc', reference, multiSource: hasBit(options, NOTCH_OPTION_BITS.multiSource) }
    case 4:
      return { mode: 'fft' }
    case 5:
      return { mode: 'rpm', sensor: 2, reference }
    default:
      return { mode: 'fixed' }
  }
}

export function notchEnabled(inputs: Inputs, prefix: NotchPrefix): boolean {
  // Upstream disables the filter when `enable <= 0`.
  return !(inputs[notchParam(prefix, 'ENABLE')] <= 0)
}

export function notchConfig(inputs: Inputs, prefix: NotchPrefix): HarmonicNotchConfig {
  const v = (field: Parameters<typeof notchParam>[1]) => inputs[notchParam(prefix, field)]
  return {
    enabled: notchEnabled(inputs, prefix),
    tracking: trackingFromParams(v('MODE'), v('REF'), v('FM_RAT'), v('OPTS')),
    baseFreqHz: v('FREQ'),
    bandwidthHz: v('BW'),
    attenuationDb: v('ATT'),
    harmonics: harmonicsFromMask(v('HMNCS')),
    composition: compositionFromOptions(v('OPTS'))
  }
}

export function operatingPoint(inputs: Inputs): OperatingPoint {
  return {
    throttle: inputs.Throttle,
    rpm1: inputs.RPM1,
    rpm2: inputs.RPM2,
    escRpm: inputs.ESC_RPM,
    numMotors: inputs.NUM_MOTORS
  }
}

export function pidGains(inputs: Inputs, axis: PidAxis): PidGains {
  return {
    kP: inputs[pidParam(axis, 'P')],
    kI: inputs[pidParam(axis, 'I')],
    kD: inputs[pidParam(axis, 'D')],
    errorCutoffHz: inputs[pidParam(axis, 'FLTE')],
    derivativeCutoffHz: inputs[pidParam(axis, 'FLTD')]
  }
}

/** Operating-point inputs a tracking mode reads. */
export type TrackingSource = 'throttle' | 'esc' | 'rpm'

/** Upstream `update_hidden_mode`'s table: the `_MODE` values that show each group of inputs. */
const TRACKING_SOURCE_MODES: readonly (readonly [TrackingSource, readonly number[]])[] = [
  ['throttle', [1]],
  ['esc', [3]],
  ['rpm', [2, 5]]
]

/**
 * Whether a notch's settings are editable (upstream `update_hidden`): `_ENABLE > 0`. This is not
 * quite the filter's own test (`!(enable <= 0)`): an empty (`NaN`) `_ENABLE` greys the settings
 * out while the notch is still applied, as upstream.
 */
export function notchInputsEnabled(inputs: Inputs, prefix: NotchPrefix): boolean {
  return inputs[notchParam(prefix, 'ENABLE')] > 0
}

/**
 * Operating-point inputs the page shows (upstream `update_hidden_mode`): those of each notch with
 * `_ENABLE > 0`, chosen by `Math.floor(_MODE)`. The maths compares the unrounded mode, so a mode
 * of 1.5 would show the throttle input while the notch stays fixed, as upstream.
 */
export function trackingSourcesShown(inputs: Inputs): ReadonlySet<TrackingSource> {
  const shown = new Set<TrackingSource>()
  for (const prefix of NOTCH_PREFIXES) {
    if (!notchInputsEnabled(inputs, prefix)) continue
    const mode = Math.floor(inputs[notchParam(prefix, 'MODE')])
    for (const [source, modes] of TRACKING_SOURCE_MODES) if (modes.includes(mode)) shown.add(source)
  }
  return shown
}
