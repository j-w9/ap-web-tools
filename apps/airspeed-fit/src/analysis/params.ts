/**
 * Suggested parameters and the `.param` file (upstream `update_saved_params` and
 * `save_parameters`; value formatting is the shared `param_to_string` port).
 */
import { paramLine } from '@apwt/ardupilot'
import type { CombinedFit } from './core.js'
import { fittedRatio } from './fit.js'
import type { AirspeedSensor, ArspdParam } from './load.js'

/** Ratios outside this range are flagged before saving. */
export const RATIO_TYPICAL_RANGE = [1.0, 3.0] as const

/** One suggested `ARSPDn_RATIO`. */
export interface RatioSuggestion {
  readonly name: ArspdParam<'RATIO'>
  /** Fitted ratio rounded to the 3 decimals shown. */
  readonly ratio: number
  readonly current: number | undefined
  /** Change from the current ratio, percent. */
  readonly changePercent: number | null
  readonly outOfRange: boolean
}

/** Per sensor: the suggestion, or null when the window had too few valid samples. */
export function ratioSuggestions(
  sensors: readonly AirspeedSensor[],
  model: CombinedFit | null
): readonly (RatioSuggestion | null)[] {
  return sensors.map((sensor, i) => {
    const raw = fittedRatio(model, i)
    if (raw === null) return null
    const ratio = Number(raw.toFixed(3))
    const current = sensor.currentRatio
    return {
      name: sensor.ratioName,
      ratio,
      current,
      // Upstream shows the change of the unrounded ratio.
      changePercent: current !== undefined ? (100 * (raw - current)) / current : null,
      outOfRange: ratio < RATIO_TYPICAL_RANGE[0] || ratio > RATIO_TYPICAL_RANGE[1]
    }
  })
}

/** Upstream's warning line for an out-of-range ratio. */
export function outOfRangeText(s: RatioSuggestion): string {
  return `${s.name} = ${s.ratio.toFixed(3)} outside typical range ${RATIO_TYPICAL_RANGE[0]} to ${RATIO_TYPICAL_RANGE[1]}`
}

/**
 * Text of the `.param` file, one `NAME,value` line per suggestion in sensor order (not the
 * natural name order of the shared `paramFileText`, as upstream writes it).
 */
export function paramFileText(suggestions: readonly (RatioSuggestion | null)[]): string {
  return suggestions.flatMap((s) => (s ? [paramLine(s.name, s.ratio)] : [])).join('')
}

/** File name upstream saves to. */
export const PARAM_FILE_NAME = 'AirspeedFit.param'
