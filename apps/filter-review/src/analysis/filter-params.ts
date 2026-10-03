import type { DataflashLog } from '@apwt/dataflash'

/** One harmonic notch configuration (upstream `params` object built by `load_filters`). */
export interface NotchParams {
  /** `_ENABLE`: > 0 enables the notch. */
  enable: number
  /** `_MODE`: tracking source, matched against `NotchTarget.modeValue`. */
  mode: number
  /** `_FREQ`: base centre frequency (Hz). */
  freq: number
  /** `_BW`: bandwidth (Hz). */
  bandwidth: number
  /** `_ATT`: attenuation (dB). */
  attenuation: number
  /** `_REF`: reference value for the tracking source (0 disables tracking). */
  ref: number
  /** `_FM_RAT`: minimum frequency ratio. */
  minRatio: number
  /** `_HMNCS`: harmonic bitmask (bit n enables harmonic n + 1), as an unsigned value. */
  harmonics: number
  /** `_OPTS`: option bitmask. */
  options: number
}

/** Every filter parameter that drives the simulation. */
export interface FilterParams {
  /** `INS_GYRO_FILTER`: gyro low-pass cut-off (Hz), <= 0 disables it. */
  gyroFilter: number
  /** `SCHED_LOOP_RATE`: main loop rate (Hz), used for aliasing. */
  loopRate: number
  /** The two harmonic notches (`INS_HNTCH_*` and `INS_HNTC2_*`). */
  notches: [NotchParams, NotchParams]
}

/** Parameter prefixes of the two harmonic notches. */
export const NOTCH_PREFIXES = ['INS_HNTCH_', 'INS_HNTC2_'] as const

/** Parameter suffix for each `NotchParams` field (upstream `get_HNotch_param_names`). */
export const NOTCH_PARAM_SUFFIXES: Readonly<Record<keyof NotchParams, string>> = {
  enable: 'ENABLE',
  mode: 'MODE',
  freq: 'FREQ',
  bandwidth: 'BW',
  attenuation: 'ATT',
  ref: 'REF',
  minRatio: 'FM_RAT',
  harmonics: 'HMNCS',
  options: 'OPTS'
}

/** Full parameter names of notch `index` (0 or 1), keyed by `NotchParams` field. */
export function notchParamNames(index: number): Record<keyof NotchParams, string> {
  const prefix = NOTCH_PREFIXES[index]
  if (prefix === undefined) throw new RangeError(`No harmonic notch ${index}`)
  const entries = Object.entries(NOTCH_PARAM_SUFFIXES).map(([key, suffix]) => [key, prefix + suffix])
  return Object.fromEntries(entries) as Record<keyof NotchParams, string>
}

/** Notch values before a log is read: page defaults plus the non-zero ones set by upstream `reset()`. */
export function defaultNotchParams(): NotchParams {
  return { enable: 0, mode: 1, freq: 80, bandwidth: 40, attenuation: 40, ref: 0, minRatio: 1, harmonics: 3, options: 0 }
}

/** Filter values before a log is read (page defaults). */
export function defaultFilterParams(): FilterParams {
  return { gyroFilter: 20, loopRate: 400, notches: [defaultNotchParams(), defaultNotchParams()] }
}

/**
 * Convert a logged bitmask value to its unsigned `bits`-wide form, as upstream
 * `parameter_get_value` does for bitmask inputs narrower than 32 bits.
 */
export function unsignedBitmask(value: number, bits: number): number {
  if (bits >= 32) return value
  let out = value
  if (out < 0) {
    out += 1 << bits
    out |= 1 << (bits - 1)
  }
  return out & (0xffffffff >>> (32 - bits))
}

/**
 * Whether the firmware supports 16 harmonics (32-bit `_HMNCS`), detected as upstream from the
 * presence of `INS_RAW_LOG_OPT`; older firmware has an 8-bit `_HMNCS`.
 */
export function hasSixteenHarmonics(log: DataflashLog): boolean {
  return log.param('INS_RAW_LOG_OPT') !== undefined
}

/** Read the filter parameters from a log (last value wins), falling back to the defaults. */
export function readFilterParams(log: DataflashLog): FilterParams {
  const params = defaultFilterParams()
  params.gyroFilter = log.param('INS_GYRO_FILTER') ?? params.gyroFilter
  params.loopRate = log.param('SCHED_LOOP_RATE') ?? params.loopRate
  const harmonicBits = hasSixteenHarmonics(log) ? 32 : 8
  params.notches.forEach((notch, index) => {
    const names = notchParamNames(index)
    for (const key of Object.keys(names) as (keyof NotchParams)[]) {
      const value = log.param(names[key])
      if (value !== undefined) notch[key] = value
    }
    notch.harmonics = unsignedBitmask(notch.harmonics, harmonicBits)
  })
  return params
}
