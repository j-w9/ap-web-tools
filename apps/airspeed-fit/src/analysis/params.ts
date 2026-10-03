/**
 * Suggested parameters and the `.param` file (upstream `update_saved_params`, `save_parameters`
 * and `param_to_string` from Libraries/Param_Helpers.js).
 */
import type { CombinedFit } from './core.js'
import { fittedRatio } from './fit.js'
import type { AirspeedSensor, ArspdParam } from './load.js'

/** Shortest decimal string that round-trips through a 32-bit float (upstream `param_to_string`). */
export function paramToString(value: number): string {
  const floatVal = Math.fround(value)
  for (const figures of [7, 8, 9]) {
    const numberVal = Number(floatVal.toPrecision(figures))
    if (floatVal !== Math.fround(numberVal)) continue
    return numberVal.toString()
  }
  throw new Error(`Could not convert ${value.toString()} to float string`)
}

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

/** Text of the `.param` file, one `NAME,value` line per suggestion in sensor order. */
export function paramFileText(suggestions: readonly (RatioSuggestion | null)[]): string {
  return suggestions.flatMap((s) => (s ? [`${s.name},${paramToString(s.ratio)}\n`] : [])).join('')
}

/** File name upstream saves to. */
export const PARAM_FILE_NAME = 'AirspeedFit.param'
